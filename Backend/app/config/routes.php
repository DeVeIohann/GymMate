 <?php
defined('PREVENT_DIRECT_ACCESS') OR exit('No direct script access allowed');
/**
 * ------------------------------------------------------------------
 * LavaLust - an opensource lightweight PHP MVC Framework
 * ------------------------------------------------------------------
 *
 * MIT License
 *
 * Copyright (c) 2020 Ronald M. Marasigan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * @package LavaLust
 * @author Ronald M. Marasigan <ronald.marasigan@yahoo.com>
 * @since Version 1
 * @link https://github.com/ronmarasigan/LavaLust
 * @license https://opensource.org/licenses/MIT MIT License
 */

/*
| -------------------------------------------------------------------
| URI ROUTING
| -------------------------------------------------------------------
| Here is where you can register web routes for your application.
|
|
*/
/** @var object $router **/

$router->get('/', 'Welcome::index');

$router->get('/api/health', 'Gymmate_api::health');
$router->post('/api/login', 'Gymmate_api::login');
$router->post('/api/register', 'Gymmate_api::register');
$router->post('/api/logout', 'Gymmate_api::logout');
$router->get('/api/gmail/status', 'Gymmate_api::gmail_status');
$router->post('/api/gmail/connect', 'Gymmate_api::connect_gmail');
$router->get('/api/gmail/callback', 'Gymmate_api::gmail_callback');
$router->post('/api/gmail/disconnect', 'Gymmate_api::disconnect_gmail');
$router->get('/api/me', 'Gymmate_api::me');
$router->patch('/api/profile', 'Gymmate_api::update_profile');
$router->get('/api/dashboard', 'Gymmate_api::dashboard');
$router->get('/api/members', 'Gymmate_api::members');
$router->post('/api/members', 'Gymmate_api::create_member');
$router->patch('/api/members', 'Gymmate_api::update_member');
$router->delete('/api/members', 'Gymmate_api::deactivate_member');
$router->get('/api/trainers', 'Gymmate_api::trainers');
$router->post('/api/trainers', 'Gymmate_api::create_trainer');
$router->patch('/api/trainers', 'Gymmate_api::update_trainer');
$router->delete('/api/trainers', 'Gymmate_api::deactivate_trainer');
$router->get('/api/availability', 'Gymmate_api::availability');
$router->get('/api/bookings', 'Gymmate_api::bookings');
$router->post('/api/bookings', 'Gymmate_api::create_booking');
$router->patch('/api/bookings', 'Gymmate_api::update_booking');
$router->get('/api/training-plans', 'Gymmate_api::training_plans');
$router->post('/api/training-plans', 'Gymmate_api::create_training_plan');
$router->get('/api/trainer-goal', 'Gymmate_api::trainer_goal');
$router->patch('/api/trainer-goal', 'Gymmate_api::update_trainer_goal');
$router->get('/api/plans', 'Gymmate_api::plans');
$router->post('/api/plans', 'Gymmate_api::create_plan');
$router->patch('/api/plans', 'Gymmate_api::update_plan');
$router->delete('/api/plans', 'Gymmate_api::archive_plan');