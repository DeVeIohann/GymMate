<?php
defined('PREVENT_DIRECT_ACCESS') OR exit('No direct script access allowed');

final class Gymmate_gmail
{
    private $client_id;
    private $client_secret;
    private $redirect_uri;

    public function __construct()
    {
        $this->client_id = getenv('GMAIL_CLIENT_ID') ?: '';
        $this->client_secret = getenv('GMAIL_CLIENT_SECRET') ?: '';
        $this->redirect_uri = getenv('GMAIL_REDIRECT_URI') ?: '';
    }

    public function is_configured()
    {
        return $this->client_id !== ''
            && $this->client_secret !== ''
            && $this->redirect_uri !== ''
            && (getenv('APP_ENCRYPTION_KEY') ?: '') !== '';
    }

    public function authorization_url($state)
    {
        return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
            'client_id' => $this->client_id,
            'redirect_uri' => $this->redirect_uri,
            'response_type' => 'code',
            'scope' => 'openid email https://www.googleapis.com/auth/gmail.send',
            'access_type' => 'offline',
            'prompt' => 'consent',
            'state' => $state,
        ], '', '&', PHP_QUERY_RFC3986);
    }

    public function exchange_code($code)
    {
        $tokens = $this->request('POST', 'https://oauth2.googleapis.com/token', [], [
            'code' => $code,
            'client_id' => $this->client_id,
            'client_secret' => $this->client_secret,
            'redirect_uri' => $this->redirect_uri,
            'grant_type' => 'authorization_code',
        ]);
        if (empty($tokens['access_token']) || empty($tokens['refresh_token'])) {
            throw new RuntimeException('Google did not return the required Gmail authorization tokens.');
        }

        $profile = $this->request('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', [
            'Authorization: Bearer ' . $tokens['access_token'],
        ]);
        if (empty($profile['emailAddress'])) {
            throw new RuntimeException('Google did not return the connected Gmail address.');
        }

        return ['email' => $profile['emailAddress'], 'refresh_token' => $tokens['refresh_token']];
    }

    public function send($refresh_token, $recipient, $subject, $body)
    {
        $tokens = $this->request('POST', 'https://oauth2.googleapis.com/token', [], [
            'client_id' => $this->client_id,
            'client_secret' => $this->client_secret,
            'refresh_token' => $refresh_token,
            'grant_type' => 'refresh_token',
        ]);
        if (empty($tokens['access_token'])) {
            throw new RuntimeException('Google could not refresh the Gmail authorization.');
        }

        $message = implode("\r\n", [
            'To: ' . $recipient,
            'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            chunk_split(base64_encode($body)),
        ]);
        $raw = rtrim(strtr(base64_encode($message), '+/', '-_'), '=');
        $this->request(
            'POST',
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            ['Authorization: Bearer ' . $tokens['access_token'], 'Content-Type: application/json'],
            ['raw' => $raw],
            true
        );
    }

    public function encrypt($value)
    {
        $key = hash('sha256', getenv('APP_ENCRYPTION_KEY'), true);
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($value, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($ciphertext === false) {
            throw new RuntimeException('Could not securely store the Gmail authorization.');
        }
        return base64_encode($iv . $tag . $ciphertext);
    }

    public function decrypt($value)
    {
        $payload = base64_decode($value, true);
        if ($payload === false || strlen($payload) < 29) {
            throw new RuntimeException('The stored Gmail authorization is invalid.');
        }
        $key = hash('sha256', getenv('APP_ENCRYPTION_KEY'), true);
        $plaintext = openssl_decrypt(
            substr($payload, 28),
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            substr($payload, 0, 12),
            substr($payload, 12, 16)
        );
        if ($plaintext === false) {
            throw new RuntimeException('The stored Gmail authorization cannot be decrypted.');
        }
        return $plaintext;
    }

    private function request($method, $url, $headers = [], $data = [], $json = false)
    {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('The PHP cURL extension is required for Gmail integration.');
        }
        $headers[] = 'Accept: application/json';
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => $headers,
        ];
        if ($method === 'POST') {
            $headers[] = $json ? 'Content-Type: application/json' : 'Content-Type: application/x-www-form-urlencoded';
            $options[CURLOPT_HTTPHEADER] = $headers;
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = $json ? json_encode($data) : http_build_query($data);
        }

        $curl = curl_init($url);
        curl_setopt_array($curl, $options);
        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        $payload = is_string($response) ? json_decode($response, true) : null;
        if ($status < 200 || $status >= 300 || !is_array($payload)) {
            throw new RuntimeException('The Gmail request failed. Check the Google account connection and API configuration.');
        }
        return $payload;
    }
}