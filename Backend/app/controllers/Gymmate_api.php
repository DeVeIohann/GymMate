<?php
defined('PREVENT_DIRECT_ACCESS') OR exit('No direct script access allowed');

class Gymmate_api extends Controller
{
    private const DEFAULT_PLAN_FEATURES = [
        'Full gym floor access',
        'Member progress dashboard',
        'Book personal training sessions',
    ];

    private $db;
    private $database_driver;
    private $gmail;

    public function before_action()
    {
        handle_cors();
        require_once APP_DIR . 'libraries/Gymmate_gmail.php';
        $this->gmail = new Gymmate_gmail();
        if (session_status() !== PHP_SESSION_ACTIVE) {
            $production = getenv('APP_ENV') === 'production';
            session_set_cookie_params([
                'httponly' => true,
                'samesite' => $production ? 'None' : 'Lax',
                'secure' => $production
                    || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
                'path' => '/',
            ]);
            session_start();
        }

        $this->database_driver = strtolower(getenv('DB_DRIVER') ?: 'sqlite');
        $this->db = $this->call->database();
        $this->initialize_schema();
        $this->expire_memberships();
    }

    public function health()
    {
        $this->respond(['status' => 'ok', 'application' => 'GymMate']);
    }

    public function login()
    {
        $input = $this->input();
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $user = $this->db->raw(
            'SELECT id, name, email, password_hash, role, status FROM gymmate_users WHERE email = ? LIMIT 1',
            [$email]
        )->fetch(PDO::FETCH_ASSOC);

        if (!$user || $user['status'] !== 'active' || !password_verify($password, $user['password_hash'])) {
            $this->respond(['error' => 'Email or password is incorrect.'], 401);
            return;
        }

        session_regenerate_id(true);
        $_SESSION['gymmate_user_id'] = (int) $user['id'];
        unset($user['password_hash']);
        $this->respond(['user' => $user]);
    }

    public function register()
    {
        $input = $this->input();
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $plan_id = filter_var($input['plan_id'] ?? null, FILTER_VALIDATE_INT);
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || !$plan_id) {
            $this->respond(['error' => 'Enter a name, valid email, password of at least 8 characters, and membership plan.'], 422);
            return;
        }

        $existing_user = $this->db->raw(
            'SELECT id FROM gymmate_users WHERE email = ? LIMIT 1',
            [$email]
        )->fetch(PDO::FETCH_ASSOC);
        if ($existing_user) {
            $this->respond(['error' => 'An account with this email already exists.'], 409);
            return;
        }

        $plan = $this->db->raw(
            'SELECT id, duration_days FROM gymmate_plans WHERE id = ? AND active = 1',
            [$plan_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$plan) {
            $this->respond(['error' => 'The selected membership plan is not available.'], 422);
            return;
        }

        $this->db->transaction();
        try {
            $this->db->raw(
                'INSERT INTO gymmate_users (name, email, password_hash, role, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$name, $email, password_hash($password, PASSWORD_DEFAULT), 'member', 'active', date('Y-m-d H:i:s')]
            );
            $member_id = $this->last_insert_id();
            $start = date('Y-m-d');
            $end = date('Y-m-d', strtotime($start . ' +' . (int) $plan['duration_days'] . ' days'));
            $this->db->raw(
                'INSERT INTO gymmate_memberships (user_id, plan_id, start_date, end_date, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$member_id, $plan_id, $start, $end, 'active', date('Y-m-d H:i:s')]
            );
            $this->db->commit();
        } catch (PDOException $exception) {
            $this->db->roll_back();
            if ($this->is_duplicate_key($exception)) {
                $this->respond(['error' => 'An account with this email already exists.'], 409);
                return;
            }
            throw $exception;
        }

        session_regenerate_id(true);
        $_SESSION['gymmate_user_id'] = $member_id;
        $this->respond([
            'user' => ['id' => $member_id, 'name' => $name, 'email' => $email, 'role' => 'member'],
        ], 201);
    }

    public function logout()
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'],
            ]);
        }
        session_destroy();
        $this->respond(['status' => 'ok']);
    }

    public function me()
    {
        $this->respond(['user' => $this->current_user()]);
    }

    public function gmail_status()
    {
        $user = $this->require_user();
        $connection = $this->db->raw(
            'SELECT email FROM gymmate_gmail_connections WHERE user_id = ?',
            [$user['id']]
        )->fetch(PDO::FETCH_ASSOC);
        $this->respond([
            'configured' => $this->gmail->is_configured(),
            'connected' => (bool) $connection,
            'email' => $connection['email'] ?? null,
        ]);
    }

    public function connect_gmail()
    {
        $user = $this->require_user();
        if (!$this->gmail->is_configured()) {
            $this->respond(['error' => 'Gmail integration is not configured on this server.'], 503);
            return;
        }
        $state = bin2hex(random_bytes(32));
        $_SESSION['gmail_oauth_state'] = $state;
        $_SESSION['gmail_oauth_user_id'] = (int) $user['id'];
        $this->respond(['authorization_url' => $this->gmail->authorization_url($state)]);
    }

    public function gmail_callback()
    {
        $state = (string) ($_GET['state'] ?? '');
        $expected_state = (string) ($_SESSION['gmail_oauth_state'] ?? '');
        $user_id = (int) ($_SESSION['gmail_oauth_user_id'] ?? 0);
        unset($_SESSION['gmail_oauth_state'], $_SESSION['gmail_oauth_user_id']);
        if ($state === '' || $expected_state === '' || !hash_equals($expected_state, $state) || $user_id < 1) {
            $this->redirect_after_gmail('error');
            return;
        }
        if (isset($_GET['error']) || empty($_GET['code'])) {
            $this->redirect_after_gmail('error');
            return;
        }

        $transaction_started = false;
        try {
            $connection = $this->gmail->exchange_code((string) $_GET['code']);
            $this->db->transaction();
            $transaction_started = true;
            $this->db->raw('DELETE FROM gymmate_gmail_connections WHERE user_id = ?', [$user_id]);
            $this->db->raw(
                'INSERT INTO gymmate_gmail_connections (user_id, email, refresh_token, connected_at) VALUES (?, ?, ?, ?)',
                [$user_id, $connection['email'], $this->gmail->encrypt($connection['refresh_token']), date('Y-m-d H:i:s')]
            );
            $this->db->commit();
            $transaction_started = false;
            $this->redirect_after_gmail('connected');
        } catch (Throwable $exception) {
            if ($transaction_started) {
                $this->db->roll_back();
            }
            error_log('GymMate Gmail connection failed: ' . $exception->getMessage());
            $this->redirect_after_gmail('error');
        }
    }

    public function disconnect_gmail()
    {
        $user = $this->require_user();
        $this->db->raw('DELETE FROM gymmate_gmail_connections WHERE user_id = ?', [$user['id']]);
        $this->respond(['status' => 'disconnected']);
    }

    public function dashboard()
    {
        $user = $this->require_user();
        $is_admin = $user['role'] === 'admin';
        $member_count = $this->db->raw(
            "SELECT COUNT(*) FROM gymmate_users WHERE role = 'member' AND status = 'active'"
        )->fetchColumn();
        $active_memberships = $this->db->raw(
            "SELECT COUNT(*) FROM gymmate_memberships WHERE status = 'active'"
        )->fetchColumn();
        $trainer_count = $this->db->raw(
            "SELECT COUNT(*) FROM gymmate_trainers tr
             JOIN gymmate_users u ON u.id = tr.user_id
             WHERE u.status = 'active'"
        )->fetchColumn();
        $pending_bookings = $this->db->raw(
            "SELECT COUNT(*) FROM gymmate_bookings WHERE status = 'pending'"
        )->fetchColumn();
        $monthly_revenue = $this->db->raw(
            "SELECT COALESCE(SUM(p.price), 0) FROM gymmate_memberships m
             JOIN gymmate_plans p ON p.id = m.plan_id
             WHERE substr(m.created_at, 1, 7) = ?",
            [date('Y-m')]
        )->fetchColumn();
        $bookings_sql = 'SELECT b.id, b.session_date, b.start_time, b.duration_minutes, b.status,
                    m.name AS member_name, t.name AS trainer_name, tr.specialty
                FROM gymmate_bookings b
                JOIN gymmate_users m ON m.id = b.member_id
                JOIN gymmate_trainers tr ON tr.id = b.trainer_id
                JOIN gymmate_users t ON t.id = tr.user_id';
        $bookings_params = [];
        if (!$is_admin && $user['role'] === 'trainer') {
            $bookings_sql .= ' WHERE tr.user_id = ?';
            $bookings_params[] = $user['id'];
        } elseif (!$is_admin && $user['role'] === 'member') {
            $bookings_sql .= ' WHERE b.member_id = ?';
            $bookings_params[] = $user['id'];
        }
        $bookings_sql .= ' ORDER BY b.session_date, b.start_time LIMIT 6';
        $upcoming = $this->db->raw($bookings_sql, $bookings_params)->fetchAll(PDO::FETCH_ASSOC);
        $membership = null;
        if ($user['role'] === 'member') {
            $membership = $this->db->raw(
                'SELECT m.status, m.start_date, m.end_date, p.name AS plan_name
                 FROM gymmate_memberships m
                 JOIN gymmate_plans p ON p.id = m.plan_id
                 WHERE m.user_id = ? ORDER BY m.id DESC LIMIT 1',
                [$user['id']]
            )->fetch(PDO::FETCH_ASSOC) ?: null;
        }

        $this->respond([
            'stats' => [
                'members' => (int) $member_count,
                'active_memberships' => (int) $active_memberships,
                'trainers' => (int) $trainer_count,
                'pending_bookings' => (int) $pending_bookings,
                'monthly_revenue' => (float) $monthly_revenue,
            ],
            'upcoming_bookings' => $upcoming,
            'membership' => $membership,
            'role' => $user['role'],
        ]);
    }

    public function members()
    {
        $this->require_role('admin');
        $rows = $this->db->raw(
                "SELECT u.id, u.name, u.email, u.health_conditions, u.status AS user_status, u.created_at,
                    m.id AS membership_id, m.status AS membership_status, m.start_date, m.end_date,
                    p.name AS plan_name, p.price AS plan_price
             FROM gymmate_users u
             LEFT JOIN gymmate_memberships m ON m.id = (
                SELECT MAX(m2.id) FROM gymmate_memberships m2 WHERE m2.user_id = u.id
             )
             LEFT JOIN gymmate_plans p ON p.id = m.plan_id
             WHERE u.role = 'member'
             ORDER BY u.created_at DESC"
        )->fetchAll(PDO::FETCH_ASSOC);
        $this->respond(['members' => $rows]);
    }

    public function create_member()
    {
        $this->require_role('admin');
        $input = $this->input();
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $health_conditions = trim((string) ($input['health_conditions'] ?? ''));
        $health_conditions_length = preg_match_all('/./us', $health_conditions);
        $plan_id = filter_var($input['plan_id'] ?? null, FILTER_VALIDATE_INT);

        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || !$plan_id || $health_conditions_length === false || $health_conditions_length > 1000) {
            $this->respond(['error' => 'Enter a name, valid email, password of at least 8 characters, membership plan, and a health note no longer than 1,000 characters.'], 422);
            return;
        }

        $existing_user = $this->db->raw(
            'SELECT id FROM gymmate_users WHERE email = ? LIMIT 1',
            [$email]
        )->fetch(PDO::FETCH_ASSOC);
        if ($existing_user) {
            $this->respond(['error' => 'An account with this email already exists.'], 409);
            return;
        }

        $plan = $this->db->raw(
            'SELECT id, duration_days FROM gymmate_plans WHERE id = ? AND active = 1',
            [$plan_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$plan) {
            $this->respond(['error' => 'The selected membership plan is not available.'], 422);
            return;
        }

        $this->db->transaction();
        try {
            $this->db->raw(
                'INSERT INTO gymmate_users (name, email, password_hash, role, status, health_conditions, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$name, $email, password_hash($password, PASSWORD_DEFAULT), 'member', 'active', $health_conditions, date('Y-m-d H:i:s')]
            );
            $member_id = $this->last_insert_id();
            $start = date('Y-m-d');
            $end = date('Y-m-d', strtotime($start . ' +' . (int) $plan['duration_days'] . ' days'));
            $this->db->raw(
                'INSERT INTO gymmate_memberships (user_id, plan_id, start_date, end_date, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$member_id, $plan_id, $start, $end, 'active', date('Y-m-d H:i:s')]
            );
            $this->db->commit();
            $this->respond(['status' => 'created', 'member_id' => $member_id], 201);
        } catch (PDOException $exception) {
            $this->db->roll_back();
            if ($this->is_duplicate_key($exception)) {
                $this->respond(['error' => 'An account with this email already exists.'], 409);
                return;
            }
            throw $exception;
        }
    }

    public function update_member()
    {
        $this->require_role('admin');
        $input = $this->input();
        $member_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $health_conditions = trim((string) ($input['health_conditions'] ?? ''));
        $health_conditions_length = preg_match_all('/./us', $health_conditions);
        if (!$member_id || $name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $health_conditions_length === false || $health_conditions_length > 1000) {
            $this->respond(['error' => 'Enter a valid member, name, email address, and health note of at most 1,000 characters.'], 422);
            return;
        }

        $member = $this->db->raw(
            "SELECT id FROM gymmate_users WHERE id = ? AND role = 'member'",
            [$member_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$member) {
            $this->respond(['error' => 'Member not found.'], 404);
            return;
        }
        $existing_email = $this->db->raw(
            'SELECT id FROM gymmate_users WHERE email = ? AND id <> ? LIMIT 1',
            [$email, $member_id]
        )->fetch(PDO::FETCH_ASSOC);
        if ($existing_email) {
            $this->respond(['error' => 'An account with this email already exists.'], 409);
            return;
        }

        $this->db->raw(
            'UPDATE gymmate_users SET name = ?, email = ?, health_conditions = ? WHERE id = ?',
            [$name, $email, $health_conditions, $member_id]
        );
        $this->respond(['status' => 'updated']);
    }

    public function deactivate_member()
    {
        $user = $this->require_role('admin');
        $input = $this->input();
        $member_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$member_id) {
            $this->respond(['error' => 'Choose a valid member.'], 422);
            return;
        }

        $member = $this->db->raw(
            "SELECT id FROM gymmate_users WHERE id = ? AND role = 'member' AND status = 'active'",
            [$member_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$member) {
            $this->respond(['error' => 'Active member not found.'], 404);
            return;
        }

        $cancelled_bookings = $this->db->raw(
            "SELECT id FROM gymmate_bookings WHERE member_id = ? AND status IN ('pending', 'confirmed')",
            [$member_id]
        )->fetchAll(PDO::FETCH_COLUMN);
        $this->db->transaction();
        try {
            $this->db->raw("UPDATE gymmate_users SET status = 'inactive' WHERE id = ?", [$member_id]);
            $this->db->raw(
                "UPDATE gymmate_memberships SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
                [$member_id]
            );
            $this->db->raw(
                "UPDATE gymmate_bookings SET status = 'cancelled' WHERE member_id = ? AND status IN ('pending', 'confirmed')",
                [$member_id]
            );
            $this->db->commit();
        } catch (PDOException $exception) {
            $this->db->roll_back();
            throw $exception;
        }
        foreach ($cancelled_bookings as $booking_id) {
            $this->notify_booking_participants((int) $booking_id, (int) $user['id']);
        }
        $this->respond(['status' => 'deactivated']);
    }

    public function trainers()
    {
        $user = $this->require_user();
        $sql = 'SELECT tr.id, u.name, u.email, tr.specialty, tr.years_experience, tr.bio, u.status
                FROM gymmate_trainers tr
                JOIN gymmate_users u ON u.id = tr.user_id';
        if ($user['role'] !== 'admin') {
            $sql .= " WHERE u.status = 'active'";
        }
        $rows = $this->db->raw($sql . ' ORDER BY u.name')->fetchAll(PDO::FETCH_ASSOC);
        $this->respond(['trainers' => $rows]);
    }

    public function create_trainer()
    {
        $this->require_role('admin');
        $input = $this->input();
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $specialty = trim((string) ($input['specialty'] ?? ''));
        $years = filter_var($input['years_experience'] ?? null, FILTER_VALIDATE_INT);
        $bio = trim((string) ($input['bio'] ?? ''));
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8 || $specialty === '' || $years === false || $years < 0 || $bio === '') {
            $this->respond(['error' => 'Enter a name, valid email, password of at least 8 characters, specialty, non-negative experience, and bio.'], 422);
            return;
        }
        if ($this->db->raw('SELECT id FROM gymmate_users WHERE email = ? LIMIT 1', [$email])->fetch(PDO::FETCH_ASSOC)) {
            $this->respond(['error' => 'An account with this email already exists.'], 409);
            return;
        }

        $this->db->transaction();
        try {
            $this->db->raw(
                'INSERT INTO gymmate_users (name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$name, $email, password_hash($password, PASSWORD_DEFAULT), 'trainer', 'active', date('Y-m-d H:i:s')]
            );
            $user_id = $this->last_insert_id();
            $this->db->raw(
                'INSERT INTO gymmate_trainers (user_id, specialty, years_experience, bio) VALUES (?, ?, ?, ?)',
                [$user_id, $specialty, $years, $bio]
            );
            $trainer_id = $this->last_insert_id();
            $this->db->commit();
        } catch (PDOException $exception) {
            $this->db->roll_back();
            if ($this->is_duplicate_key($exception)) {
                $this->respond(['error' => 'An account with this email already exists.'], 409);
                return;
            }
            throw $exception;
        }
        $this->respond(['status' => 'created', 'trainer_id' => $trainer_id], 201);
    }

    public function update_trainer()
    {
        $this->require_role('admin');
        $input = $this->input();
        $trainer_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $name = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $specialty = trim((string) ($input['specialty'] ?? ''));
        $years = filter_var($input['years_experience'] ?? null, FILTER_VALIDATE_INT);
        $bio = trim((string) ($input['bio'] ?? ''));
        if (!$trainer_id || $name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $specialty === '' || $years === false || $years < 0 || $bio === '') {
            $this->respond(['error' => 'Enter a valid trainer, name, email, specialty, non-negative experience, and bio.'], 422);
            return;
        }

        $trainer = $this->db->raw(
            'SELECT tr.id, tr.user_id FROM gymmate_trainers tr WHERE tr.id = ?',
            [$trainer_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$trainer) {
            $this->respond(['error' => 'Trainer not found.'], 404);
            return;
        }
        if ($this->db->raw('SELECT id FROM gymmate_users WHERE email = ? AND id <> ? LIMIT 1', [$email, $trainer['user_id']])->fetch(PDO::FETCH_ASSOC)) {
            $this->respond(['error' => 'An account with this email already exists.'], 409);
            return;
        }

        $this->db->raw('UPDATE gymmate_users SET name = ?, email = ? WHERE id = ?', [$name, $email, $trainer['user_id']]);
        $this->db->raw(
            'UPDATE gymmate_trainers SET specialty = ?, years_experience = ?, bio = ? WHERE id = ?',
            [$specialty, $years, $bio, $trainer_id]
        );
        $this->respond(['status' => 'updated']);
    }

    public function deactivate_trainer()
    {
        $user = $this->require_role('admin');
        $input = $this->input();
        $trainer_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$trainer_id) {
            $this->respond(['error' => 'Choose a valid trainer.'], 422);
            return;
        }
        $trainer = $this->db->raw(
            "SELECT tr.id, tr.user_id FROM gymmate_trainers tr JOIN gymmate_users u ON u.id = tr.user_id WHERE tr.id = ? AND u.status = 'active'",
            [$trainer_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$trainer) {
            $this->respond(['error' => 'Active trainer not found.'], 404);
            return;
        }

        $cancelled_bookings = $this->db->raw(
            "SELECT id FROM gymmate_bookings WHERE trainer_id = ? AND status IN ('pending', 'confirmed')",
            [$trainer_id]
        )->fetchAll(PDO::FETCH_COLUMN);
        $this->db->transaction();
        try {
            $this->db->raw("UPDATE gymmate_users SET status = 'inactive' WHERE id = ?", [$trainer['user_id']]);
            $this->db->raw(
                "UPDATE gymmate_bookings SET status = 'cancelled' WHERE trainer_id = ? AND status IN ('pending', 'confirmed')",
                [$trainer_id]
            );
            $this->db->commit();
        } catch (PDOException $exception) {
            $this->db->roll_back();
            throw $exception;
        }
        foreach ($cancelled_bookings as $booking_id) {
            $this->notify_booking_participants((int) $booking_id, (int) $user['id']);
        }
        $this->respond(['status' => 'deactivated']);
    }

    public function bookings()
    {
        $user = $this->require_user();
        $sql = 'SELECT b.id, b.session_date, b.start_time, b.duration_minutes, b.status, b.note,
                       m.name AS member_name, m.id AS member_id,
                       t.name AS trainer_name, tr.id AS trainer_id, tr.specialty
                FROM gymmate_bookings b
                JOIN gymmate_users m ON m.id = b.member_id
                JOIN gymmate_trainers tr ON tr.id = b.trainer_id
                JOIN gymmate_users t ON t.id = tr.user_id';
        $params = [];
        if ($user['role'] === 'member') {
            $sql .= ' WHERE b.member_id = ?';
            $params[] = $user['id'];
        } elseif ($user['role'] === 'trainer') {
            $sql .= ' WHERE tr.user_id = ?';
            $params[] = $user['id'];
        }
        $sql .= ' ORDER BY b.session_date DESC, b.start_time DESC';
        $this->respond(['bookings' => $this->db->raw($sql, $params)->fetchAll(PDO::FETCH_ASSOC)]);
    }

    public function training_plans()
    {
        $user = $this->require_role('trainer');
        $rows = $this->db->raw(
            'SELECT p.id, p.member_id, m.name AS member_name, p.title, p.goal, p.exercises, p.created_at
             FROM gymmate_training_plans p
             JOIN gymmate_users m ON m.id = p.member_id
             WHERE p.trainer_user_id = ?
             ORDER BY p.created_at DESC, p.id DESC',
            [$user['id']]
        )->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            $row['exercises'] = json_decode($row['exercises'], true);
        }
        unset($row);
        $this->respond(['training_plans' => $rows]);
    }

    public function create_training_plan()
    {
        $user = $this->require_role('trainer');
        $input = $this->input();
        $member_id = filter_var($input['member_id'] ?? null, FILTER_VALIDATE_INT);
        $title = trim((string) ($input['title'] ?? ''));
        $goal = trim((string) ($input['goal'] ?? ''));
        $exercises = $input['exercises'] ?? null;
        if (!$member_id || $title === '' || strlen($title) > 120 || $goal === '' || !is_array($exercises) || count($exercises) < 1 || count($exercises) > 30) {
            $this->respond(['error' => 'Choose a client and enter a title, goal, and 1 to 30 exercises.'], 422);
            return;
        }

        $member = $this->db->raw(
            "SELECT u.id FROM gymmate_users u
             WHERE u.id = ? AND u.role = 'member' AND u.status = 'active'
             AND EXISTS (
                SELECT 1 FROM gymmate_bookings b
                JOIN gymmate_trainers tr ON tr.id = b.trainer_id
                WHERE b.member_id = u.id AND tr.user_id = ?
             )",
            [$member_id, $user['id']]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$member) {
            $this->respond(['error' => 'Choose an active client from your training schedule.'], 422);
            return;
        }

        $normalized_exercises = [];
        foreach ($exercises as $exercise) {
            if (!is_array($exercise)) {
                $this->respond(['error' => 'Each exercise needs a name, sets, and reps.'], 422);
                return;
            }
            $name = trim((string) ($exercise['name'] ?? ''));
            $sets = filter_var($exercise['sets'] ?? null, FILTER_VALIDATE_INT);
            $reps = trim((string) ($exercise['reps'] ?? ''));
            if ($name === '' || strlen($name) > 120 || $sets === false || $sets < 1 || $sets > 50 || $reps === '' || strlen($reps) > 40) {
                $this->respond(['error' => 'Each exercise needs a name, 1 to 50 sets, and a reps target.'], 422);
                return;
            }
            $normalized_exercises[] = ['name' => $name, 'sets' => $sets, 'reps' => $reps];
        }

        $this->db->raw(
            'INSERT INTO gymmate_training_plans (trainer_user_id, member_id, title, goal, exercises, created_at)
             VALUES (?, ?, ?, ?, ?, ?)',
            [(int) $user['id'], $member_id, $title, $goal, json_encode($normalized_exercises), date('Y-m-d H:i:s')]
        );
        $this->respond(['status' => 'created', 'training_plan_id' => $this->last_insert_id()], 201);
    }

    public function trainer_goal()
    {
        $user = $this->require_role('trainer');
        $goal = $this->db->raw(
            'SELECT weekly_session_goal FROM gymmate_trainers WHERE user_id = ?',
            [$user['id']]
        )->fetchColumn();
        if ($goal === false) {
            $this->respond(['error' => 'Trainer profile not found.'], 404);
            return;
        }
        $this->respond(['weekly_session_goal' => (int) $goal]);
    }

    public function update_trainer_goal()
    {
        $user = $this->require_role('trainer');
        $input = $this->input();
        $goal = filter_var($input['weekly_session_goal'] ?? null, FILTER_VALIDATE_INT);
        if ($goal === false || $goal < 1 || $goal > 100) {
            $this->respond(['error' => 'Set a weekly session goal between 1 and 100.'], 422);
            return;
        }
        $updated = $this->db->raw(
            'UPDATE gymmate_trainers SET weekly_session_goal = ? WHERE user_id = ?',
            [$goal, $user['id']]
        );
        if ($updated->rowCount() === 0) {
            $exists = $this->db->raw('SELECT id FROM gymmate_trainers WHERE user_id = ?', [$user['id']])->fetch(PDO::FETCH_ASSOC);
            if (!$exists) {
                $this->respond(['error' => 'Trainer profile not found.'], 404);
                return;
            }
        }
        $this->respond(['weekly_session_goal' => $goal]);
    }

    public function availability()
    {
        $this->require_role('member');
        $trainer_id = filter_var($_GET['trainer_id'] ?? null, FILTER_VALIDATE_INT);
        $month = (string) ($_GET['month'] ?? '');
        $month_date = DateTime::createFromFormat('!Y-m', $month);
        if (!$trainer_id || !$month_date || $month_date->format('Y-m') !== $month || $month < date('Y-m')) {
            $this->respond(['error' => 'Choose a valid trainer and current or future month.'], 422);
            return;
        }

        $trainer = $this->db->raw(
            "SELECT tr.id FROM gymmate_trainers tr
             JOIN gymmate_users u ON u.id = tr.user_id
             WHERE tr.id = ? AND u.status = 'active'",
            [$trainer_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$trainer) {
            $this->respond(['error' => 'The selected trainer is not available.'], 404);
            return;
        }

        $month_start = $month_date->format('Y-m-01');
        $month_end = $month_date->format('Y-m-t');
        $unavailable_dates = $this->db->raw(
            "SELECT DISTINCT session_date FROM gymmate_bookings
             WHERE trainer_id = ? AND session_date BETWEEN ? AND ?
             AND status IN ('pending', 'confirmed')
             ORDER BY session_date",
            [$trainer_id, $month_start, $month_end]
        )->fetchAll(PDO::FETCH_COLUMN);
        $this->respond(['unavailable_dates' => $unavailable_dates]);
    }

    public function create_booking()
    {
        $user = $this->require_role('member');
        $input = $this->input();
        $trainer_id = filter_var($input['trainer_id'] ?? null, FILTER_VALIDATE_INT);
        $session_date = (string) ($input['session_date'] ?? '');
        $start_time = (string) ($input['start_time'] ?? '');
        $date = DateTime::createFromFormat('Y-m-d', $session_date);
        $time = DateTime::createFromFormat('H:i', $start_time);
        $requested_at = DateTime::createFromFormat('Y-m-d H:i', $session_date . ' ' . $start_time);
        if (!$trainer_id || !$date || $date->format('Y-m-d') !== $session_date || !$time || $time->format('H:i') !== $start_time || !$requested_at || $requested_at < new DateTime()) {
            $this->respond(['error' => 'Choose a valid trainer, future date, and start time.'], 422);
            return;
        }

        $trainer = $this->db->raw(
            "SELECT tr.id FROM gymmate_trainers tr
             JOIN gymmate_users u ON u.id = tr.user_id
             WHERE tr.id = ? AND u.status = 'active'",
            [$trainer_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$trainer) {
            $this->respond(['error' => 'The selected trainer is not available.'], 404);
            return;
        }

        $existing_booking = $this->db->raw(
            "SELECT id FROM gymmate_bookings
             WHERE trainer_id = ? AND session_date = ?
             AND status IN ('pending', 'confirmed')
             LIMIT 1",
            [$trainer_id, $session_date]
        )->fetch(PDO::FETCH_ASSOC);
        if ($existing_booking) {
            $this->respond(['error' => 'That trainer is already booked on this date. Please choose another date.'], 409);
            return;
        }

        $this->db->raw(
            'INSERT INTO gymmate_bookings (member_id, trainer_id, session_date, start_time, duration_minutes, status, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [(int) $user['id'], $trainer_id, $session_date, $start_time, 60, 'pending', trim((string) ($input['note'] ?? '')), date('Y-m-d H:i:s')]
        );
        $this->notify_booking_participants($this->last_insert_id(), (int) $user['id']);
        $this->respond(['status' => 'created'], 201);
    }

    public function update_booking()
    {
        $user = $this->require_user();
        $input = $this->input();
        $booking_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $status = (string) ($input['status'] ?? '');
        $allowed = ['pending', 'confirmed', 'completed', 'cancelled'];
        if (!$booking_id || !in_array($status, $allowed, true)) {
            $this->respond(['error' => 'Choose a valid booking and status.'], 422);
            return;
        }

        $booking = $this->db->raw(
            'SELECT b.id, b.member_id, b.status, tr.user_id AS trainer_user_id
             FROM gymmate_bookings b JOIN gymmate_trainers tr ON tr.id = b.trainer_id
             WHERE b.id = ?',
            [$booking_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$booking) {
            $this->respond(['error' => 'Booking not found.'], 404);
            return;
        }
        $is_admin = $user['role'] === 'admin';
        $is_assigned_trainer = $user['role'] === 'trainer' && (int) $booking['trainer_user_id'] === (int) $user['id'];
        $is_booking_member = $user['role'] === 'member' && (int) $booking['member_id'] === (int) $user['id'];
        if (!$is_admin && !$is_assigned_trainer && !($is_booking_member && $status === 'cancelled')) {
            $this->respond(['error' => 'You do not have permission to update this booking.'], 403);
            return;
        }

        if ($booking['status'] !== $status) {
            $this->db->raw('UPDATE gymmate_bookings SET status = ? WHERE id = ?', [$status, $booking_id]);
            $this->notify_booking_participants($booking_id, (int) $user['id']);
        }
        $this->respond(['status' => 'updated']);
    }

    public function plans()
    {
        $user = $this->current_user();
        $include_archived = $user && $user['role'] === 'admin';
        $sql = 'SELECT id, name, duration_days, price, description, features, active FROM gymmate_plans';
        if (!$include_archived) {
            $sql .= ' WHERE active = 1';
        }
        $rows = $this->db->raw($sql . ' ORDER BY price')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            $features = json_decode((string) ($row['features'] ?? ''), true);
            $row['features'] = is_array($features) && $features ? $features : self::DEFAULT_PLAN_FEATURES;
        }
        unset($row);
        $this->respond(['plans' => $rows]);
    }

    public function create_plan()
    {
        $this->require_role('admin');
        $input = $this->input();
        $name = trim((string) ($input['name'] ?? ''));
        $duration = filter_var($input['duration_days'] ?? null, FILTER_VALIDATE_INT);
        $price = filter_var($input['price'] ?? null, FILTER_VALIDATE_FLOAT);
        $description = trim((string) ($input['description'] ?? ''));
        $features = $this->normalize_plan_features($input['features'] ?? self::DEFAULT_PLAN_FEATURES);
        if ($name === '' || !$duration || $duration < 1 || $price === false || $price < 0 || $description === '' || !$features) {
            $this->respond(['error' => 'Enter a plan name, valid duration, non-negative price, description, and at least one feature.'], 422);
            return;
        }

        $this->db->raw(
            'INSERT INTO gymmate_plans (name, duration_days, price, description, features, active) VALUES (?, ?, ?, ?, ?, ?)',
            [$name, $duration, $price, $description, json_encode($features), 1]
        );
        $this->respond(['status' => 'created', 'plan_id' => $this->last_insert_id()], 201);
    }

    public function update_plan()
    {
        $this->require_role('admin');
        $input = $this->input();
        $id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $name = trim((string) ($input['name'] ?? ''));
        $duration = filter_var($input['duration_days'] ?? null, FILTER_VALIDATE_INT);
        $price = filter_var($input['price'] ?? null, FILTER_VALIDATE_FLOAT);
        $description = trim((string) ($input['description'] ?? ''));
        $features = $this->normalize_plan_features($input['features'] ?? self::DEFAULT_PLAN_FEATURES);
        $active = filter_var($input['active'] ?? 1, FILTER_VALIDATE_INT);
        if (!$id || $name === '' || !$duration || $duration < 1 || $price === false || $price < 0 || $description === '' || !$features || !in_array($active, [0, 1], true)) {
            $this->respond(['error' => 'Enter a valid plan, duration, non-negative price, description, at least one feature, and status.'], 422);
            return;
        }
        if (!$this->db->raw('SELECT id FROM gymmate_plans WHERE id = ?', [$id])->fetch(PDO::FETCH_ASSOC)) {
            $this->respond(['error' => 'Membership plan not found.'], 404);
            return;
        }

        $this->db->raw(
            'UPDATE gymmate_plans SET name = ?, duration_days = ?, price = ?, description = ?, features = ?, active = ? WHERE id = ?',
            [$name, $duration, $price, $description, json_encode($features), $active, $id]
        );
        $this->respond(['status' => 'updated']);
    }

    private function normalize_plan_features($features)
    {
        if (!is_array($features)) {
            return null;
        }

        $normalized = [];
        foreach ($features as $feature) {
            if (!is_string($feature)) {
                return null;
            }
            $feature = trim($feature);
            if ($feature !== '') {
                $normalized[] = $feature;
            }
        }
        return array_values(array_unique($normalized));
    }

    public function archive_plan()
    {
        $this->require_role('admin');
        $input = $this->input();
        $id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) {
            $this->respond(['error' => 'Choose a valid membership plan.'], 422);
            return;
        }
        if (!$this->db->raw('SELECT id FROM gymmate_plans WHERE id = ?', [$id])->fetch(PDO::FETCH_ASSOC)) {
            $this->respond(['error' => 'Membership plan not found.'], 404);
            return;
        }
        $this->db->raw('UPDATE gymmate_plans SET active = 0 WHERE id = ?', [$id]);
        $this->respond(['status' => 'archived']);
    }

    private function initialize_schema()
    {
        $id_definition = $this->database_driver === 'mysql'
            ? 'INTEGER PRIMARY KEY AUTO_INCREMENT'
            : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_users (
                id $id_definition,
                name VARCHAR(120) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                health_conditions TEXT NULL,
                created_at DATETIME NOT NULL
            )"
        );
        if ($this->database_driver === 'mysql') {
            $has_health_conditions = $this->db->raw("SHOW COLUMNS FROM gymmate_users LIKE 'health_conditions'")->fetch(PDO::FETCH_ASSOC) !== false;
        } else {
            $user_columns = $this->db->raw('PRAGMA table_info(gymmate_users)')->fetchAll(PDO::FETCH_ASSOC);
            $has_health_conditions = false;
            foreach ($user_columns as $column) {
                if ($column['name'] === 'health_conditions') {
                    $has_health_conditions = true;
                    break;
                }
            }
        }
        if (!$has_health_conditions) {
            $this->db->raw('ALTER TABLE gymmate_users ADD COLUMN health_conditions TEXT NULL');
        }
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_plans (
                id $id_definition,
                name VARCHAR(100) NOT NULL,
                duration_days INTEGER NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                description TEXT NOT NULL,
                features TEXT NULL,
                active INTEGER NOT NULL DEFAULT 1
            )"
        );
        if ($this->database_driver === 'mysql') {
            $has_plan_features = $this->db->raw("SHOW COLUMNS FROM gymmate_plans LIKE 'features'")->fetch(PDO::FETCH_ASSOC) !== false;
        } else {
            $plan_columns = $this->db->raw('PRAGMA table_info(gymmate_plans)')->fetchAll(PDO::FETCH_ASSOC);
            $has_plan_features = false;
            foreach ($plan_columns as $column) {
                if ($column['name'] === 'features') {
                    $has_plan_features = true;
                    break;
                }
            }
        }
        if (!$has_plan_features) {
            $this->db->raw('ALTER TABLE gymmate_plans ADD COLUMN features TEXT NULL');
        }
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_memberships (
                id $id_definition,
                user_id INTEGER NOT NULL,
                plan_id INTEGER NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'active',
                created_at DATETIME NOT NULL,
                FOREIGN KEY (user_id) REFERENCES gymmate_users(id),
                FOREIGN KEY (plan_id) REFERENCES gymmate_plans(id)
            )"
        );
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_trainers (
                id $id_definition,
                user_id INTEGER NOT NULL UNIQUE,
                specialty VARCHAR(120) NOT NULL,
                years_experience INTEGER NOT NULL DEFAULT 0,
                bio TEXT NOT NULL,
                weekly_session_goal INTEGER NOT NULL DEFAULT 10,
                FOREIGN KEY (user_id) REFERENCES gymmate_users(id)
            )"
        );
        if ($this->database_driver === 'mysql') {
            $has_weekly_goal = $this->db->raw("SHOW COLUMNS FROM gymmate_trainers LIKE 'weekly_session_goal'")->fetch(PDO::FETCH_ASSOC) !== false;
        } else {
            $trainer_columns = $this->db->raw('PRAGMA table_info(gymmate_trainers)')->fetchAll(PDO::FETCH_ASSOC);
            $has_weekly_goal = false;
            foreach ($trainer_columns as $column) {
                if ($column['name'] === 'weekly_session_goal') {
                    $has_weekly_goal = true;
                    break;
                }
            }
        }
        if (!$has_weekly_goal) {
            $this->db->raw('ALTER TABLE gymmate_trainers ADD COLUMN weekly_session_goal INTEGER NOT NULL DEFAULT 10');
        }
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_bookings (
                id $id_definition,
                member_id INTEGER NOT NULL,
                trainer_id INTEGER NOT NULL,
                session_date DATE NOT NULL,
                start_time TIME NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 60,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                note TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (member_id) REFERENCES gymmate_users(id),
                FOREIGN KEY (trainer_id) REFERENCES gymmate_trainers(id)
            )"
        );
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_training_plans (
                id $id_definition,
                trainer_user_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                title VARCHAR(120) NOT NULL,
                goal TEXT NOT NULL,
                exercises TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (trainer_user_id) REFERENCES gymmate_users(id),
                FOREIGN KEY (member_id) REFERENCES gymmate_users(id)
            )"
        );
        $this->db->raw(
            "CREATE TABLE IF NOT EXISTS gymmate_gmail_connections (
                user_id INTEGER PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                refresh_token TEXT NOT NULL,
                connected_at DATETIME NOT NULL,
                FOREIGN KEY (user_id) REFERENCES gymmate_users(id)
            )"
        );

        if ((int) $this->db->raw('SELECT COUNT(*) FROM gymmate_users')->fetchColumn() > 0) {
            return;
        }

        $now = date('Y-m-d H:i:s');
        $accounts = [
            ['Alex Morgan', 'admin@gymmate.local', 'admin'],
            ['Jamie Lee', 'trainer@gymmate.local', 'trainer'],
            ['Taylor Reed', 'member@gymmate.local', 'member'],
            ['Jordan Blake', 'sam@gymmate.local', 'member'],
            ['Riley Chen', 'riley@gymmate.local', 'member'],
            ['Casey Park', 'casey@gymmate.local', 'member'],
        ];
        $user_ids = [];
        foreach ($accounts as $account) {
            $this->db->raw(
                'INSERT INTO gymmate_users (name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$account[0], $account[1], password_hash('GymMate123!', PASSWORD_DEFAULT), $account[2], 'active', $now]
            );
            $user_ids[] = $this->last_insert_id();
        }

        $plans = [
            ['Starter', 30, 899, 'A simple start with full gym access.'],
            ['Momentum', 90, 2299, 'Three months of steady progress.'],
            ['Unlimited', 365, 7999, 'Your best value for a full year of training.'],
        ];
        $plan_ids = [];
        foreach ($plans as $plan) {
            $this->db->raw(
                'INSERT INTO gymmate_plans (name, duration_days, price, description) VALUES (?, ?, ?, ?)',
                $plan
            );
            $plan_ids[] = $this->last_insert_id();
        }

        foreach ([2, 1, 0, 1] as $offset => $plan_index) {
            $start = date('Y-m-d', strtotime('-' . ($offset * 12) . ' days'));
            $end = date('Y-m-d', strtotime($start . ' +' . $plans[$plan_index][1] . ' days'));
            $this->db->raw(
                'INSERT INTO gymmate_memberships (user_id, plan_id, start_date, end_date, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$user_ids[$offset + 2], $plan_ids[$plan_index], $start, $end, $end < date('Y-m-d') ? 'expired' : 'active', $now]
            );
        }

        $trainer_profiles = [
            [$user_ids[1], 'Strength & conditioning', 8, 'Focused coaching for strength, form, and sustainable progress.'],
        ];
        foreach ($trainer_profiles as $profile) {
            $this->db->raw(
                'INSERT INTO gymmate_trainers (user_id, specialty, years_experience, bio) VALUES (?, ?, ?, ?)',
                $profile
            );
        }

        $trainer_id = (int) $this->db->raw('SELECT id FROM gymmate_trainers LIMIT 1')->fetchColumn();
        $sample_slots = [
            [date('Y-m-d', strtotime('+2 days')), '09:00', 'confirmed'],
            [date('Y-m-d', strtotime('+3 days')), '14:30', 'pending'],
            [date('Y-m-d', strtotime('+5 days')), '11:00', 'pending'],
        ];
        foreach ($sample_slots as $index => $slot) {
            $this->db->raw(
                'INSERT INTO gymmate_bookings (member_id, trainer_id, session_date, start_time, duration_minutes, status, note, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$user_ids[$index + 2], $trainer_id, $slot[0], $slot[1], 60, $slot[2], 'Personal training session', $now]
            );
        }
    }

    private function expire_memberships()
    {
        $this->db->raw(
            "UPDATE gymmate_memberships SET status = 'expired' WHERE end_date < ? AND status = 'active'",
            [date('Y-m-d')]
        );
    }

    private function input()
    {
        $input = $this->request->json();
        return is_array($input) ? $input : [];
    }

    private function current_user()
    {
        $user_id = (int) ($_SESSION['gymmate_user_id'] ?? 0);
        if ($user_id < 1) {
            return null;
        }
        return $this->db->raw(
            'SELECT id, name, email, role FROM gymmate_users WHERE id = ? AND status = ?',
            [$user_id, 'active']
        )->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function notify_booking_participants($booking_id, $actor_id)
    {
        $connection = $this->db->raw(
            'SELECT refresh_token FROM gymmate_gmail_connections WHERE user_id = ?',
            [$actor_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$connection) {
            return;
        }

        $booking = $this->db->raw(
            'SELECT b.session_date, b.start_time, b.status, m.id AS member_id, m.name AS member_name, m.email AS member_email,
                    t.id AS trainer_id, t.name AS trainer_name, t.email AS trainer_email
             FROM gymmate_bookings b
             JOIN gymmate_users m ON m.id = b.member_id
             JOIN gymmate_trainers tr ON tr.id = b.trainer_id
             JOIN gymmate_users t ON t.id = tr.user_id
             WHERE b.id = ?',
            [$booking_id]
        )->fetch(PDO::FETCH_ASSOC);
        if (!$booking) {
            return;
        }

        $recipients = [];
        if ((int) $booking['member_id'] !== $actor_id) {
            $recipients[] = $booking['member_email'];
        }
        if ((int) $booking['trainer_id'] !== $actor_id) {
            $recipients[] = $booking['trainer_email'];
        }
        $subject = 'GymMate session ' . $booking['status'];
        $body = implode("\n", [
            'A GymMate training session has been ' . $booking['status'] . '.',
            '',
            'Member: ' . $booking['member_name'],
            'Trainer: ' . $booking['trainer_name'],
            'Date: ' . $booking['session_date'],
            'Time: ' . substr($booking['start_time'], 0, 5),
        ]);

        try {
            $refresh_token = $this->gmail->decrypt($connection['refresh_token']);
            foreach (array_unique($recipients) as $recipient) {
                $this->gmail->send($refresh_token, $recipient, $subject, $body);
            }
        } catch (Throwable $exception) {
            error_log('GymMate Gmail notification failed: ' . $exception->getMessage());
        }
    }

    private function redirect_after_gmail($result)
    {
        $frontend_url = rtrim(getenv('FRONTEND_URL') ?: 'http://127.0.0.1:5173', '/');
        header('Location: ' . $frontend_url . '/?gmail=' . rawurlencode($result), true, 302);
        exit;
    }

    private function require_user()
    {
        $user = $this->current_user();
        if (!$user) {
            $this->respond(['error' => 'Please sign in to continue.'], 401);
        }
        return $user;
    }

    private function require_role($role)
    {
        $user = $this->require_user();
        if ($user['role'] !== $role) {
            $this->respond(['error' => 'You do not have permission to perform this action.'], 403);
        }
        return $user;
    }

    private function respond($payload, $status = 200)
    {
        $this->response->send_json($payload, $status);
        exit;
    }

    private function last_insert_id()
    {
        $query = $this->database_driver === 'mysql'
            ? 'SELECT LAST_INSERT_ID()'
            : 'SELECT last_insert_rowid()';
        return (int) $this->db->raw($query)->fetchColumn();
    }

    private function is_duplicate_key(PDOException $exception)
    {
        $message = strtolower($exception->getMessage());
        return $exception->getCode() === '23000'
            || strpos($message, 'unique') !== false
            || strpos($message, 'duplicate') !== false;
    }
}
