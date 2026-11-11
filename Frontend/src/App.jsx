import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  Ellipsis,
  Eye,
  EyeOff,
  Mail,
  LayoutDashboard,
  LogOut,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Settings,
  Users,
  UserRoundX,
  X,
} from 'lucide-react';

const money = (value) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value || 0));

const defaultPlanFeatures = [
  'Full gym floor access',
  'Member progress dashboard',
  'Book personal training sessions',
];

const dateLabel = (value, options = { month: 'short', day: 'numeric' }) =>
  value ? new Intl.DateTimeFormat('en', options).format(new Date(`${value}T00:00:00`)) : '—';

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, roles: ['admin', 'trainer', 'member'] },
  { id: 'members', label: 'Members', icon: Users, roles: ['admin'] },
  { id: 'trainers', label: 'Trainers', icon: Dumbbell, roles: ['admin', 'member'] },
  { id: 'bookings', label: 'Sessions', icon: CalendarDays, roles: ['admin', 'trainer', 'member'] },
  { id: 'plans', label: 'Membership plans', icon: ShieldCheck, roles: ['admin', 'member'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin', 'trainer', 'member'] },
];

function App() {
  const [publicView, setPublicView] = useState('landing');
  const [user, setUser] = useState(null);
  const [section, setSection] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [members, setMembers] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [plans, setPlans] = useState([]);
  const [trainingPlans, setTrainingPlans] = useState([]);
  const [weeklySessionGoal, setWeeklySessionGoal] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modal, setModal] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [selectedTrainer, setSelectedTrainer] = useState(null);
  const [selectedBookingTrainer, setSelectedBookingTrainer] = useState('');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [search, setSearch] = useState('');

  const refreshData = useCallback(async (role) => {
    const currentRole = role || user?.role;
    if (!currentRole) return;
    const [overview, trainerData, bookingData, planData] = await Promise.all([
      api('/dashboard'),
      api('/trainers'),
      api('/bookings'),
      api('/plans'),
    ]);
    setDashboard(overview);
    setTrainers(trainerData.trainers);
    setBookings(bookingData.bookings);
    setPlans(planData.plans);
    if (currentRole === 'trainer') {
      const [trainingPlanData, trainerGoalData] = await Promise.all([
        api('/training-plans'),
        api('/trainer-goal'),
      ]);
      setTrainingPlans(trainingPlanData.training_plans);
      setWeeklySessionGoal(trainerGoalData.weekly_session_goal);
    }
    if (currentRole === 'admin') {
      const memberData = await api('/members');
      setMembers(memberData.members);
    }
  }, [user?.role]);

  useEffect(() => {
    let active = true;
    api('/me')
      .then(async ({ user: currentUser }) => {
        if (!active) return;
        setUser(currentUser);
        if (currentUser) await refreshData(currentUser.role);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshData]);

  useEffect(() => {
    const gmailResult = new URLSearchParams(window.location.search).get('gmail');
    if (!gmailResult) return;
    setSection('settings');
    setSuccess(gmailResult === 'connected' ? 'Gmail connected.' : 'Gmail could not be connected.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const runAction = async (action, message) => {
    setError('');
    setSuccess('');
    try {
      await action();
      await refreshData();
      setSuccess(message);
      setModal('');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const signOut = async () => {
    try {
      await api('/logout', { method: 'POST', body: '{}' });
      setUser(null);
      setDashboard(null);
      setError('');
      setSuccess('');
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter((member) =>
      !query || `${member.name} ${member.email} ${member.plan_name || ''}`.toLowerCase().includes(query),
    );
  }, [members, search]);

  if (loading) {
    return <div className="loading-screen"><span className="brand-mark"><Dumbbell size={20} /></span><span>Getting GymMate ready…</span></div>;
  }
  if (!user) {
    if (publicView === 'landing') {
      return <LandingPage onSignIn={() => setPublicView('login')} onJoin={() => setPublicView('register')} />;
    }
    return <LoginScreen initialRegistering={publicView === 'register'} onBack={() => setPublicView('landing')} onLogin={(nextUser) => {
      setUser(nextUser);
      setError('');
      setSection('overview');
      refreshData(nextUser.role).catch((requestError) => setError(requestError.message));
    }} error={error} />;
  }

  const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1);
  const visibleNav = navItems.filter((item) => item.roles.includes(user.role));
  const title = navItems.find((item) => item.id === section)?.label || 'Overview';
  const pendingCount = bookings.filter((booking) => booking.status === 'pending').length;

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setSection('overview'); }}>
            <span className="brand-mark"><Dumbbell size={20} strokeWidth={2.5} /></span>
            <span>gym<span className="brand-light">mate</span><small>TRAINING, TOGETHER</small></span>
          </a>
          <nav className="site-nav" aria-label="Main navigation">
            {visibleNav.map(({ id, label }) => (
              <button key={id} className={`site-nav-item ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
                {label}{id === 'bookings' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}
              </button>
            ))}
          </nav>
          <div className="site-user">
            <span className="site-user-name">{user.name}</span>
            <button aria-label="Sign out" title="Sign out" className="icon-button signout-button" onClick={signOut}><LogOut size={17} /></button>
          </div>
        </div>
      </header>

      <main className="main-area">
        <div className="page-content">
          {user.role === 'member' && section === 'overview' && <div className="portal-heading">
            <div><span className="portal-kicker">Greenfield Fitness · {roleLabel} workspace</span><h1>Dashboard</h1></div>
            <span className="today-label"><CalendarDays size={15} /> {new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span>
          </div>}
          {(error || success) && (
            <div className={`notice ${error ? 'notice-error' : 'notice-success'}`} role="status">
              {error ? error : success}
              <button aria-label="Dismiss message" onClick={() => { setError(''); setSuccess(''); }}><X size={16} /></button>
            </div>
          )}
          {section === 'overview' && <Overview
            user={user}
            dashboard={dashboard}
            bookings={bookings}
            trainingPlans={trainingPlans}
            weeklySessionGoal={weeklySessionGoal}
            onNavigate={setSection}
            onAddTrainingPlan={() => setModal('training-plan')}
            onSaveWeeklyGoal={(value) => runAction(
              () => api('/trainer-goal', { method: 'PATCH', body: JSON.stringify({ weekly_session_goal: value }) }),
              'Weekly session goal updated.',
            )}
            onUpdateBooking={(id, status) => runAction(
              () => api('/bookings', { method: 'PATCH', body: JSON.stringify({ id, status }) }),
              `Session marked ${status}.`,
            )}
          />}
          {section === 'members' && <Members
            members={filteredMembers}
            onSearch={setSearch}
            onAdd={() => { setSelectedMember(null); setModal('member'); }}
            onEdit={(member) => { setSelectedMember(member); setModal('member'); }}
            onDeactivate={(member) => {
              if (window.confirm(`Deactivate ${member.name}? Their history will be retained, and future sessions will be cancelled.`)) {
                runAction(() => api('/members', { method: 'DELETE', body: JSON.stringify({ id: member.id }) }), 'Member deactivated.');
              }
            }}
          />}
          {section === 'trainers' && <Trainers
            trainers={trainers}
            user={user}
            onBook={(trainer) => {
              setSelectedBookingTrainer(trainer ? String(trainer.id) : '');
              setModal('booking');
            }}
            onAdd={() => { setSelectedTrainer(null); setModal('trainer'); }}
            onEdit={(trainer) => { setSelectedTrainer(trainer); setModal('trainer'); }}
            onDeactivate={(trainer) => {
              if (window.confirm(`Deactivate ${trainer.name}? Their profile is retained, and future sessions will be cancelled.`)) {
                runAction(() => api('/trainers', { method: 'DELETE', body: JSON.stringify({ id: trainer.id }) }), 'Trainer deactivated.');
              }
            }}
          />}
          {section === 'bookings' && <Bookings bookings={bookings} role={user.role} onUpdate={(id, status) => runAction(() => api('/bookings', { method: 'PATCH', body: JSON.stringify({ id, status }) }), `Session marked ${status}.`)} onBook={() => {
            setSelectedBookingTrainer('');
            setModal('booking');
          }} />}
          {section === 'plans' && <Plans
            plans={plans}
            user={user}
            onAdd={() => { setSelectedPlan(null); setModal('plan'); }}
            onEdit={(plan) => { setSelectedPlan(plan); setModal('plan'); }}
            onArchive={(plan) => runAction(
              () => plan.active
                ? api('/plans', { method: 'DELETE', body: JSON.stringify({ id: plan.id }) })
                : api('/plans', { method: 'PATCH', body: JSON.stringify({ ...plan, active: 1 }) }),
              plan.active ? 'Membership plan archived.' : 'Membership plan restored.',
            )}
          />}
          {section === 'settings' && <GmailSettings />}
        </div>
      </main>

      {modal === 'member' && <MemberModal member={selectedMember} plans={plans} onClose={() => setModal('')} onSubmit={(values) => runAction(
        () => selectedMember
          ? api('/members', { method: 'PATCH', body: JSON.stringify({ ...values, id: selectedMember.id }) })
          : api('/members', { method: 'POST', body: JSON.stringify(values) }),
        selectedMember ? 'Member details updated.' : 'Member added and membership activated.',
      )} />}
      {modal === 'trainer' && <TrainerModal trainer={selectedTrainer} onClose={() => setModal('')} onSubmit={(values) => runAction(
        () => selectedTrainer
          ? api('/trainers', { method: 'PATCH', body: JSON.stringify({ ...values, id: selectedTrainer.id }) })
          : api('/trainers', { method: 'POST', body: JSON.stringify(values) }),
        selectedTrainer ? 'Trainer details updated.' : 'Trainer added.',
      )} />}
      {modal === 'booking' && <BookingModal trainers={trainers} initialTrainerId={selectedBookingTrainer} onClose={() => setModal('')} onSubmit={(values) => runAction(() => api('/bookings', { method: 'POST', body: JSON.stringify(values) }), 'Training session requested.')} />}
      {modal === 'training-plan' && <TrainingPlanModal
        clients={[...new Map(bookings.map((booking) => [booking.member_id, { id: booking.member_id, name: booking.member_name }])).values()]}
        onClose={() => setModal('')}
        onSubmit={(values) => runAction(
          () => api('/training-plans', { method: 'POST', body: JSON.stringify(values) }),
          'Training plan created.',
        )}
      />}
      {modal === 'plan' && <PlanModal plan={selectedPlan} onClose={() => setModal('')} onSubmit={(values) => {
        setModal('');
        runAction(
          () => selectedPlan
            ? api('/plans', { method: 'PATCH', body: JSON.stringify({ ...values, id: selectedPlan.id, active: selectedPlan.active }) })
            : api('/plans', { method: 'POST', body: JSON.stringify(values) }),
          selectedPlan ? 'Membership plan updated.' : 'Membership plan created.',
        );
      }} />}
    </div>
  );
}

function GmailSettings() {
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadConnection = () => api('/gmail/status').then(setConnection).catch((requestError) => setError(requestError.message));
  useEffect(() => { loadConnection(); }, []);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const { authorization_url } = await api('/gmail/connect', { method: 'POST', body: '{}' });
      window.location.assign(authorization_url);
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/gmail/disconnect', { method: 'POST', body: '{}' });
      await loadConnection();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gmail-settings-page">
      <div className="page-heading"><div><div className="eyebrow"><span /> ACCOUNT PREFERENCES</div><h1>Settings</h1><p>Manage how GymMate sends your training updates.</p></div></div>
      {error && <div className="notice notice-error" role="status">{error}</div>}
      <section className="gmail-connection">
        <div className="gmail-connection-mark"><Mail size={21} /></div>
        <div className="gmail-connection-copy">
          <h2>Gmail notifications</h2>
          {!connection ? <p>Loading connection status…</p> : connection.connected ? (
            <><p>Connected as <b>{connection.email}</b></p><span className="gmail-status"><i /> Session updates will be emailed to other attendees.</span></>
          ) : (
            <><p>Connect Gmail to email other attendees when you request, confirm, or cancel a training session.</p>{!connection.configured && <span className="gmail-unavailable">Gmail OAuth is not configured on this server.</span>}</>
          )}
        </div>
        {connection?.connected ? (
          <button className="secondary-button" disabled={busy} onClick={disconnect}>{busy ? 'Working…' : 'Disconnect'}</button>
        ) : (
          <button className="primary-button" disabled={busy || !connection?.configured} onClick={connect}><Mail size={16} /> {busy ? 'Connecting…' : 'Connect Gmail'}</button>
        )}
      </section>
    </div>
  );
}

function LandingPage({ onSignIn, onJoin }) {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <a className="brand landing-brand" href="#home">
          <span className="brand-mark"><Dumbbell size={20} strokeWidth={2.5} /></span>
          <span>gym<span className="brand-light">mate</span><small>TRAINING, TOGETHER</small></span>
        </a>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#experience">The experience</a>
          <a href="#community">Our approach</a>
        </nav>
        <div className="landing-actions">
          <button className="landing-signin" onClick={onSignIn}>Sign in</button>
          <button className="landing-join" onClick={onJoin}>Join GymMate <ArrowUpRight size={16} /></button>
        </div>
      </header>

      <main id="home">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow"><i /> A BETTER WAY TO TRAIN</span>
            <h1>Make room for<br />your <em>stronger</em> self.</h1>
            <p>Your goals deserve more than a routine. Find your people, work with a coach, and build a rhythm that lasts.</p>
            <div className="landing-hero-actions">
              <button className="landing-join landing-hero-join" onClick={onJoin}>Find your membership <ArrowUpRight size={17} /></button>
              <button className="landing-secondary-action" onClick={onSignIn}>I already have an account <ArrowUpRight size={15} /></button>
            </div>
            <div className="landing-proof"><span className="proof-mark"><Check size={14} /></span><span>Good coaching. Real community. Progress at your pace.</span></div>
          </div>
          <div className="landing-hero-image" role="img" aria-label="Athlete training in a bright, modern gym">
            <div className="hero-image-caption"><span className="caption-mark"><Dumbbell size={16} /></span><span><b>Show up for yourself</b><small>We’ll help with the rest.</small></span></div>
          </div>
          <div className="landing-hero-index"><span>01</span><i /> TRAINING, TOGETHER</div>
        </section>

        <section className="landing-experience" id="experience">
          <div className="landing-section-intro"><span className="landing-eyebrow">YOUR GYM, IN SYNC</span><h2>Everything you need<br />to keep moving.</h2></div>
          <div className="landing-feature-list">
            <article><span className="landing-feature-icon"><ShieldCheck size={20} /></span><div><h3>A plan that fits your life</h3><p>Choose a membership built around your schedule and the way you want to train.</p></div><span className="feature-number">01</span></article>
            <article><span className="landing-feature-icon feature-icon-coral"><Dumbbell size={20} /></span><div><h3>Coaching with connection</h3><p>Meet experienced trainers who help you turn your goals into a steady practice.</p></div><span className="feature-number">02</span></article>
            <article><span className="landing-feature-icon feature-icon-yellow"><CalendarDays size={20} /></span><div><h3>Time for your next session</h3><p>Browse availability and request training sessions that work for you.</p></div><span className="feature-number">03</span></article>
          </div>
        </section>

        <section className="landing-community" id="community">
          <div><span className="landing-eyebrow">BETTER, TOGETHER</span><h2>Progress isn’t a place.<br />It’s a practice.</h2></div>
          <div className="landing-community-copy"><p>Big milestones start with small decisions. GymMate brings your membership, trainers, and sessions into one place, so it’s easier to keep showing up.</p><button className="landing-community-link" onClick={onJoin}>Start your next chapter <ArrowUpRight size={16} /></button></div>
        </section>
      </main>

      <footer className="landing-footer"><a className="brand landing-brand" href="#home"><span className="brand-mark"><Dumbbell size={18} /></span><span>gym<span className="brand-light">mate</span></span></a><span>© {new Date().getFullYear()} GymMate</span><span>Stronger, together.</span></footer>
    </div>
  );
}

function LoginScreen({ initialRegistering = false, onBack, onLogin, error }) {
  const [registering, setRegistering] = useState(initialRegistering);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error);

  useEffect(() => {
    if (!registering) return;
    api('/plans')
      .then(({ plans: availablePlans }) => {
        setPlans(availablePlans);
        setPlanId(String(availablePlans[0]?.id || ''));
      })
      .catch((requestError) => setMessage(requestError.message));
  }, [registering]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = registering
        ? await api('/register', { method: 'POST', body: JSON.stringify({ name, email, password, plan_id: Number(planId) }) })
        : await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onLogin(result.user);
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-decoration decoration-one" /><div className="login-decoration decoration-two" />
      <button className="login-brand" onClick={onBack} aria-label="Back to GymMate home"><span className="brand-mark"><Dumbbell size={20} strokeWidth={2.5} /></span><span>gym<span className="brand-light">mate</span></span></button>
      <div className="login-card">
        <div className="login-eyebrow"><span /> YOUR GYM, IN SYNC</div>
        <h1>{registering ? 'Start your journey.' : 'Welcome back.'}</h1>
        <p className="login-intro">{registering ? 'Create your member account and choose a plan to get started.' : 'Sign in to manage your memberships, sessions, and progress.'}</p>
        {message && <div className="notice notice-error">{message}</div>}
        <form onSubmit={submit} className="login-form">
          {registering && <label>Full name<input type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label>}
          <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          {registering && <label>Membership plan<select required value={planId} onChange={(event) => setPlanId(event.target.value)}>{plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {money(plan.price)}</option>)}</select></label>}
          <button className="primary-button login-submit" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create member account' : 'Sign in'}<ArrowUpRight size={17} /></button>
        </form>
        <button className="login-toggle" onClick={() => { setRegistering(!registering); setMessage(''); }}>{registering ? 'Already have an account? Sign in' : 'New to GymMate? Create a member account'}</button>
        {!registering && <div className="demo-box"><ShieldCheck size={17} /><span><b>Demo access</b><small>Admin · admin@gymmate.local · GymMate123!</small></span></div>}
        <div className="login-footnote">{registering ? 'Memberships are managed by your local gym.' : 'Local demo accounts are for development only.'}</div>
      </div>
      <div className="login-footer"><span>© {new Date().getFullYear()} GymMate</span><span>Stronger, together.</span></div>
    </div>
  );
}

function Overview({
  user,
  dashboard,
  bookings,
  trainingPlans,
  weeklySessionGoal,
  onNavigate,
  onAddTrainingPlan,
  onSaveWeeklyGoal,
  onUpdateBooking,
}) {
  if (user.role === 'member') {
    return <MemberOverview user={user} dashboard={dashboard} bookings={bookings} onNavigate={onNavigate} />;
  }
  if (user.role === 'trainer') {
    return <TrainerOverview
      user={user}
      bookings={bookings}
      trainingPlans={trainingPlans}
      weeklySessionGoal={weeklySessionGoal}
      onNavigate={onNavigate}
      onAddTrainingPlan={onAddTrainingPlan}
      onSaveWeeklyGoal={onSaveWeeklyGoal}
      onUpdate={onUpdateBooking}
    />;
  }
  const stats = dashboard?.stats || {};
  const membership = dashboard?.membership;
  const cards = user.role === 'admin'
    ? [
      { label: 'Active members', value: stats.members || 0, change: 'Across all plans', icon: Users, tint: 'mint' },
      { label: 'Active memberships', value: stats.active_memberships || 0, change: 'Renewal-ready members', icon: ShieldCheck, tint: 'lavender' },
      { label: 'Trainer sessions', value: stats.trainers || 0, change: 'Coaches on your team', icon: Dumbbell, tint: 'peach' },
      { label: 'Monthly revenue', value: money(stats.monthly_revenue), change: 'Membership sales', icon: Activity, tint: 'blue' },
    ]
    : [
      { label: 'Upcoming sessions', value: bookings.filter((item) => item.status !== 'cancelled').length, change: 'Your training schedule', icon: CalendarDays, tint: 'mint' },
      { label: 'Pending requests', value: bookings.filter((item) => item.status === 'pending').length, change: 'Waiting for a response', icon: Clock3, tint: 'lavender' },
      { label: 'Available trainers', value: stats.trainers || 0, change: 'Ready to help you progress', icon: Dumbbell, tint: 'peach' },
      { label: 'Membership status', value: membership?.status ? membership.status.charAt(0).toUpperCase() + membership.status.slice(1) : 'No plan', change: membership?.end_date ? `${membership.plan_name} · Expires ${dateLabel(membership.end_date)}` : 'Choose a plan to get started', icon: ShieldCheck, tint: 'blue' },
    ];
  const firstName = user.name.split(' ')[0];
  return (
    <>
      <div className="welcome-row">
        <div><div className="eyebrow"><span /> YOUR NEXT CHAPTER STARTS HERE</div><h1>Good morning, {firstName}<span className="wave">.</span></h1><p>Here’s what’s happening at your gym today.</p></div>
        <button className="primary-button" onClick={() => onNavigate(user.role === 'admin' ? 'members' : 'trainers')}><Plus size={17} /> {user.role === 'admin' ? 'Add a member' : 'Find a trainer'}</button>
      </div>
      <div className="stats-grid">
        {cards.map(({ label, value, change, icon: Icon, tint }, index) => (
          <article className="stat-card" key={label}>
            <div className={`stat-icon ${tint}`}><Icon size={19} /></div>
            <span className="stat-menu"><Ellipsis size={19} /></span>
            <div className="stat-label">{label}</div><div className="stat-value">{value}</div>
            <div className={`stat-change ${index === 0 && user.role === 'admin' ? 'change-positive' : ''}`}>{index === 0 && user.role === 'admin' ? <ArrowUpRight size={14} /> : <span className="change-dot" />}{change}</div>
          </article>
        ))}
      </div>
      <div className="content-grid">
        <section className="panel schedule-panel">
          <div className="panel-heading"><div><h2>Upcoming sessions</h2><p>Your gym’s latest training activity</p></div><button className="text-button" onClick={() => onNavigate('bookings')}>View all <ArrowUpRight size={15} /></button></div>
          <BookingTable bookings={(dashboard?.upcoming_bookings || []).slice(0, 5)} showMember={user.role !== 'member'} />
        </section>
        <aside className="panel quick-panel">
          <div className="panel-heading"><div><h2>Quick actions</h2><p>Keep things moving</p></div></div>
          <button className="quick-action" onClick={() => onNavigate(user.role === 'admin' ? 'members' : 'trainers')}><span className="quick-icon mint"><Users size={18} /></span><span><b>{user.role === 'admin' ? 'Manage members' : 'Meet your trainers'}</b><small>{user.role === 'admin' ? 'View profiles and memberships' : 'Explore coaches and specialties'}</small></span><ArrowUpRight size={16} /></button>
          <button className="quick-action" onClick={() => onNavigate('bookings')}><span className="quick-icon peach"><CalendarDays size={18} /></span><span><b>Training sessions</b><small>{user.role === 'admin' ? `${stats.pending_bookings || 0} requests need attention` : 'See your training calendar'}</small></span><ArrowUpRight size={16} /></button>
          <div className="coach-tip"><div className="tip-heading"><Activity size={15} /> GYMMATE TIP</div><p>Small, consistent steps make lasting progress. Keep showing up for yourself.</p><span>— Your GymMate team</span></div>
        </aside>
      </div>
    </>
  );
}

function TrainerOverview({
  user,
  bookings,
  trainingPlans,
  weeklySessionGoal,
  onNavigate,
  onAddTrainingPlan,
  onSaveWeeklyGoal,
  onUpdate,
}) {
  const [goalInput, setGoalInput] = useState(String(weeklySessionGoal));
  const [savingGoal, setSavingGoal] = useState(false);
  useEffect(() => setGoalInput(String(weeklySessionGoal)), [weeklySessionGoal]);
  const today = new Date();
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartValue = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndValue = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;
  const todaySessions = bookings
    .filter((booking) => booking.session_date === todayValue && booking.status !== 'cancelled')
    .sort((first, second) => first.start_time.localeCompare(second.start_time));
  const upcomingSessions = bookings
    .filter((booking) => booking.session_date >= todayValue && ['pending', 'confirmed'].includes(booking.status))
    .sort((first, second) =>
      `${first.session_date} ${first.start_time}`.localeCompare(`${second.session_date} ${second.start_time}`),
    );
  const pendingSessions = bookings.filter((booking) => booking.status === 'pending');
  const activeClients = new Set(
    bookings.filter((booking) => booking.status !== 'cancelled').map((booking) => booking.member_id),
  ).size;
  const completedThisWeek = bookings.filter((booking) =>
    booking.status === 'completed' && booking.session_date >= weekStartValue && booking.session_date <= weekEndValue,
  ).length;
  const goalProgress = Math.min(100, Math.round((completedThisWeek / weeklySessionGoal) * 100));
  const firstName = user.name.split(' ')[0];
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const stats = [
    { label: "Today's sessions", value: todaySessions.length, note: 'On your schedule', icon: CalendarDays, tint: 'mint' },
    { label: 'Pending requests', value: pendingSessions.length, note: 'Need your response', icon: Clock3, tint: 'peach' },
    { label: 'Upcoming sessions', value: upcomingSessions.length, note: 'Confirmed or requested', icon: Activity, tint: 'lavender' },
    { label: 'Clients coached', value: activeClients, note: 'Across your sessions', icon: Users, tint: 'blue' },
  ];

  const renderSession = (booking) => (
    <article className="trainer-session-row" key={booking.id}>
      <span className="trainer-session-time">
        <b>{booking.start_time?.slice(0, 5)}</b>
        <small>{booking.duration_minutes} min</small>
      </span>
      <span className="trainer-session-person">
        <span className="user-avatar">{booking.member_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
        <span><b>{booking.member_name}</b><small>{booking.specialty || 'Personal training'}</small></span>
      </span>
      <StatusPill status={booking.status} />
      <span className="trainer-session-actions"><BookingActions booking={booking} role="trainer" onUpdate={onUpdate} /></span>
    </article>
  );

  return (
    <div className="trainer-dashboard">
      <section className="trainer-welcome">
        <div>
          <div className="eyebrow"><span /> TRAINER WORKSPACE</div>
          <h1>{greeting}, {firstName}<span className="wave">.</span></h1>
          <p>Here’s your coaching schedule and the sessions that need your attention.</p>
        </div>
        <div className="trainer-date"><CalendarDays size={16} /><span>{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(today)}</span></div>
      </section>

      <section className="panel trainer-weekly-goal">
        <div className="trainer-weekly-goal-heading">
          <div className="trainer-goal-icon"><Activity size={18} /></div>
          <div><h2>This week’s coaching progress</h2><p>{completedThisWeek} of {weeklySessionGoal} completed sessions</p></div>
          <form className="trainer-goal-form" onSubmit={async (event) => {
            event.preventDefault();
            setSavingGoal(true);
            try {
              await onSaveWeeklyGoal(Number(goalInput));
            } finally {
              setSavingGoal(false);
            }
          }}>
            <label htmlFor="weekly-session-goal">Weekly goal</label>
            <input id="weekly-session-goal" type="number" min="1" max="100" required value={goalInput} onChange={(event) => setGoalInput(event.target.value)} />
            <button type="submit" className="secondary-button" disabled={savingGoal || Number(goalInput) === weeklySessionGoal}>{savingGoal ? 'Saving…' : 'Update'}</button>
          </form>
        </div>
        <div className="trainer-progress-track" role="progressbar" aria-label="Weekly completed sessions" aria-valuemin="0" aria-valuemax={weeklySessionGoal} aria-valuenow={Math.min(completedThisWeek, weeklySessionGoal)}>
          <span style={{ width: `${goalProgress}%` }} />
        </div>
        <div className="trainer-progress-footer"><span>{goalProgress}% of weekly goal</span><span>{Math.max(weeklySessionGoal - completedThisWeek, 0)} sessions to go</span></div>
      </section>

      <div className="stats-grid trainer-stats-grid">
        {stats.map(({ label, value, note, icon: Icon, tint }) => (
          <article className="stat-card trainer-stat-card" key={label}>
            <div className={`stat-icon ${tint}`}><Icon size={19} /></div>
            <div className="stat-label">{label}</div><div className="stat-value">{value}</div>
            <div className="stat-change"><span className="change-dot" />{note}</div>
          </article>
        ))}
      </div>

      <div className="trainer-dashboard-grid">
        <section className="panel trainer-agenda-panel">
          <div className="panel-heading">
            <div><h2>Today’s schedule</h2><p>{todaySessions.length ? `${todaySessions.length} session${todaySessions.length === 1 ? '' : 's'} on your calendar` : 'Your coaching agenda for today'}</p></div>
            <button className="text-button" onClick={() => onNavigate('bookings')}>All sessions <ArrowUpRight size={15} /></button>
          </div>
          {todaySessions.length ? <div className="trainer-session-list">{todaySessions.map(renderSession)}</div> : (
            <div className="empty-state"><CalendarDays size={22} /><b>No sessions today</b><span>Your schedule is clear for now.</span></div>
          )}
        </section>

        <aside className="panel trainer-requests-panel">
          <div className="panel-heading">
            <div><h2>Requests to review</h2><p>{pendingSessions.length ? 'Respond to your members' : 'You’re all caught up'}</p></div>
            {pendingSessions.length > 0 && <span className="trainer-request-count">{pendingSessions.length}</span>}
          </div>
          {pendingSessions.length ? (
            <div className="trainer-request-list">{pendingSessions.slice(0, 4).map((booking) => (
              <article className="trainer-request" key={booking.id}>
                <div className="trainer-request-top">
                  <span className="user-avatar">{booking.member_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
                  <span className="trainer-request-copy"><b>{booking.member_name}</b><small>{booking.specialty || 'Personal training'}</small></span>
                </div>
                <div className="trainer-request-date"><CalendarDays size={14} />{dateLabel(booking.session_date, { month: 'short', day: 'numeric' })} · {booking.start_time?.slice(0, 5)}</div>
                <div className="trainer-request-actions"><BookingActions booking={booking} role="trainer" onUpdate={onUpdate} /></div>
              </article>
            ))}</div>
          ) : <div className="trainer-requests-empty"><span className="quick-icon mint"><Check size={18} /></span><p>New session requests will appear here.</p></div>}
          <button className="trainer-view-sessions" onClick={() => onNavigate('bookings')}>Manage all sessions <ArrowUpRight size={15} /></button>
        </aside>
      </div>

      <section className="trainer-programs-section">
        <div className="trainer-programs-heading">
          <div><h2>Client training plans</h2><p>Workout programs you’ve created for your clients.</p></div>
          <button className="primary-button" onClick={onAddTrainingPlan}><Plus size={16} /> Create a plan</button>
        </div>
        {trainingPlans.length ? <div className="trainer-program-grid">{trainingPlans.map((plan) => (
          <article className="panel trainer-program-card" key={plan.id}>
            <div className="trainer-program-top"><span className="quick-icon mint"><Dumbbell size={17} /></span><span className="trainer-program-client">{plan.member_name}</span></div>
            <h3>{plan.title}</h3>
            <p className="trainer-program-goal">{plan.goal}</p>
            <div className="trainer-exercise-list">{plan.exercises.map((exercise, index) => (
              <div className="trainer-exercise" key={`${plan.id}-${index}`}><span><b>{exercise.name}</b><small>{exercise.sets} sets · {exercise.reps} reps</small></span><Check size={15} /></div>
            ))}</div>
          </article>
        ))}</div> : <div className="panel trainer-program-empty"><span className="quick-icon mint"><Dumbbell size={18} /></span><div><b>No client plans yet</b><p>Create a structured workout program for a client from your training schedule.</p></div><button className="secondary-button" onClick={onAddTrainingPlan}>Create first plan <ArrowUpRight size={14} /></button></div>}
      </section>

      <section className="panel trainer-upcoming-panel">
        <div className="panel-heading">
          <div><h2>Coming up</h2><p>Your next confirmed sessions and requests.</p></div>
          <button className="text-button" onClick={() => onNavigate('bookings')}>Open calendar <ArrowUpRight size={15} /></button>
        </div>
        {upcomingSessions.length ? <div className="trainer-session-list">{upcomingSessions.slice(0, 5).map((booking) => (
          <article className="trainer-session-row" key={booking.id}>
            <span className="trainer-session-time"><b>{dateLabel(booking.session_date, { month: 'short', day: 'numeric' })}</b><small>{booking.start_time?.slice(0, 5)}</small></span>
            <span className="trainer-session-person">
              <span className="user-avatar">{booking.member_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
              <span><b>{booking.member_name}</b><small>{booking.specialty || 'Personal training'} · {booking.duration_minutes} min</small></span>
            </span>
            <StatusPill status={booking.status} />
            <span className="trainer-session-actions"><BookingActions booking={booking} role="trainer" onUpdate={onUpdate} /></span>
          </article>
        ))}</div> : <div className="empty-state"><CalendarDays size={22} /><b>No upcoming sessions</b><span>Future sessions will appear here when members book.</span></div>}
      </section>
    </div>
  );
}

function MemberOverview({ user, dashboard, bookings, onNavigate }) {
  const membership = dashboard?.membership;
  const upcomingSessions = dashboard?.upcoming_bookings || [];
  const activity = [...bookings].sort((first, second) =>
    new Date(`${second.session_date}T${second.start_time || '00:00'}`) - new Date(`${first.session_date}T${first.start_time || '00:00'}`),
  ).slice(0, 4);

  return (
    <div className="member-dashboard">
      <section className="portal-section">
        <div className="section-heading"><div><h2>Active membership</h2><p>Your plan and account at a glance.</p></div><button className="text-button" onClick={() => onNavigate('plans')}>View plans <ArrowUpRight size={15} /></button></div>
        <div className="membership-grid">
          <article className="membership-summary">
            <span className="summary-label">CURRENT PLAN</span>
            <h3>{membership?.plan_name || 'No active plan'}</h3>
            <div className="membership-details"><StatusPill status={membership?.status || 'inactive'} /><span>{membership?.end_date ? `Valid through ${dateLabel(membership.end_date, { month: 'long', day: 'numeric', year: 'numeric' })}` : 'Choose a plan to get started.'}</span></div>
          </article>
          <article className="account-summary">
            <span className="summary-label">YOUR ACCOUNT</span>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <button className="secondary-button" onClick={() => onNavigate('trainers')}>Find a trainer <ArrowUpRight size={15} /></button>
          </article>
        </div>
      </section>

      <section className="portal-band">
        <div className="section-heading"><div><h2>Upcoming sessions</h2><p>Your next opportunities to train.</p></div><button className="text-button" onClick={() => onNavigate('bookings')}>All sessions <ArrowUpRight size={15} /></button></div>
        {upcomingSessions.length ? <div className="session-card-grid">{upcomingSessions.slice(0, 3).map((session) => (
          <article className="member-session-card" key={session.id}>
            <div className="session-card-top"><span className="session-icon"><Dumbbell size={16} /></span><StatusPill status={session.status} /></div>
            <h3>{session.specialty || 'Training session'}</h3>
            <p>With {session.trainer_name || 'your trainer'}</p>
            <div className="session-card-date"><CalendarDays size={14} /> {dateLabel(session.session_date, { month: 'long', day: 'numeric' })} · {session.start_time?.slice(0, 5)}</div>
          </article>
        ))}</div> : <div className="portal-empty">No upcoming sessions. Browse trainers to plan your next workout.</div>}
      </section>

      <div className="member-lower-grid">
        <section className="portal-section activity-section">
          <div className="section-heading"><div><h2>Recent activity</h2><p>Updates from your training schedule.</p></div></div>
          {activity.length ? <div className="activity-list">{activity.map((session) => (
            <div className="activity-row" key={session.id}><span className="activity-mark"><CalendarDays size={15} /></span><span className="activity-copy"><b>{session.specialty || 'Training session'}</b><small>{session.trainer_name} · {dateLabel(session.session_date, { month: 'short', day: 'numeric' })}</small></span><StatusPill status={session.status} /></div>
          ))}</div> : <div className="portal-empty">Your session updates will appear here.</div>}
        </section>
        <section className="portal-section profile-section">
          <div className="section-heading"><div><h2>Update profile</h2><p>Keep your account details current.</p></div></div>
          <dl className="profile-details"><div><dt>Full name</dt><dd>{user.name}</dd></div><div><dt>Email address</dt><dd>{user.email}</dd></div></dl>
          <p className="profile-note">To change your account details, contact your gym administrator.</p>
        </section>
      </div>
    </div>
  );
}

function BookingTable({ bookings, showMember }) {
  if (!bookings.length) return <div className="empty-state"><CalendarDays size={22} /><b>No sessions scheduled yet</b><span>New training sessions will show up here.</span></div>;
  return (
    <div className="table-scroll"><table className="data-table"><thead><tr><th>SESSION</th>{showMember && <th>MEMBER</th>}<th>TRAINER</th><th>DATE & TIME</th><th>STATUS</th></tr></thead>
      <tbody>{bookings.map((booking) => <tr key={booking.id}>
        <td><span className="session-cell"><span className="session-icon"><Dumbbell size={15} /></span><span><b>{booking.specialty || 'Training session'}</b><small>{booking.duration_minutes || 60} min · Personal training</small></span></span></td>
        {showMember && <td>{booking.member_name}</td>}
        <td>{booking.trainer_name}</td><td>{dateLabel(booking.session_date)} <span className="time-muted">{booking.start_time?.slice(0, 5)}</span></td>
        <td><StatusPill status={booking.status} /></td>
      </tr>)}</tbody>
    </table></div>
  );
}

function Members({ members, onSearch, onAdd, onEdit, onDeactivate }) {
  const activeCount = members.filter((member) => member.user_status === 'active' && member.membership_status === 'active').length;
  const needsRenewalCount = members.filter((member) => member.user_status === 'active' && member.membership_status !== 'active').length;
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow"><span /> PEOPLE & MEMBERSHIPS</div><h1>Members</h1><p>Build stronger relationships, one member at a time.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> Add member</button></div>
      <div className="members-summary"><div><span className="summary-icon mint"><Users size={19} /></span><span><small>Total members</small><b>{members.length}</b></span></div><div><span className="summary-icon blue"><Check size={19} /></span><span><small>Active memberships</small><b>{activeCount}</b></span></div><div><span className="summary-icon peach"><Clock3 size={19} /></span><span><small>Needs renewal</small><b>{needsRenewalCount}</b></span></div></div>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Member directory</h2><p>Manage your gym community and plan status.</p></div><label className="search-field"><Search size={16} /><input placeholder="Search members…" onChange={(event) => onSearch(event.target.value)} /></label></div>
        {members.length ? <div className="table-scroll"><table className="data-table member-table"><thead><tr><th>MEMBER</th><th>HEALTH CONDITIONS</th><th>MEMBERSHIP PLAN</th><th>EXPIRES</th><th>STATUS</th><th>JOINED</th><th>ACTIONS</th></tr></thead><tbody>
          {members.map((member) => <tr key={member.id}><td><span className="person-cell"><span className="user-avatar">{member.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{member.name}</b><small>{member.email}</small></span></span></td><td>{member.health_conditions || '—'}</td><td>{member.plan_name || 'No plan'}</td><td>{dateLabel(member.end_date, { month: 'short', day: 'numeric', year: 'numeric' })}</td><td><StatusPill status={member.user_status === 'inactive' ? 'inactive' : member.membership_status || 'inactive'} /></td><td>{dateLabel(member.created_at?.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })}</td><td><div className="member-actions"><button className="icon-button" aria-label={`Edit ${member.name}`} title="Edit member" onClick={() => onEdit(member)}><Pencil size={15} /></button>{member.user_status === 'active' && <button className="icon-button member-deactivate" aria-label={`Deactivate ${member.name}`} title="Deactivate member" onClick={() => onDeactivate(member)}><UserRoundX size={16} /></button>}</div></td></tr>)}
        </tbody></table></div> : <div className="empty-state"><Users size={22} /><b>No members found</b><span>Try another search, or add your first member.</span></div>}
      </section>
    </>
  );
}

function Trainers({ trainers, user, onBook, onAdd, onEdit, onDeactivate }) {
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow"><span /> COACHING & CONNECTION</div><h1>{user.role === 'admin' ? 'Trainers' : 'Meet your trainers'}</h1><p>{user.role === 'admin' ? 'Manage trainer profiles and account access.' : 'Good coaching makes every goal feel within reach.'}</p></div>{user.role === 'admin' ? <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add trainer</button> : user.role === 'member' && <button className="primary-button" onClick={onBook}><CalendarDays size={17} /> Book a session</button>}</div>
      <div className="trainer-grid">{trainers.map((trainer, index) => <article className="trainer-card" key={trainer.id}>
        <div className={`trainer-cover cover-${index % 3}`}><span className="trainer-monogram">{trainer.name.split(' ').map((part) => part[0]).join('')}</span><span className={`available-tag ${trainer.status === 'inactive' ? 'unavailable-tag' : ''}`}><i />{trainer.status === 'inactive' ? 'Inactive' : 'Available'}</span></div>
        <div className="trainer-info"><div className="trainer-title"><div><h2>{trainer.name}</h2><p>{trainer.specialty}</p></div>{user.role === 'admin' && <div className="member-actions"><button className="icon-button" aria-label={`Edit ${trainer.name}`} title="Edit trainer" onClick={() => onEdit(trainer)}><Pencil size={15} /></button>{trainer.status === 'active' && <button className="icon-button member-deactivate" aria-label={`Deactivate ${trainer.name}`} title="Deactivate trainer" onClick={() => onDeactivate(trainer)}><UserRoundX size={16} /></button>}</div>}</div>
          <div className="trainer-bio">{trainer.bio}</div><div className="trainer-meta"><span><Activity size={14} /> {trainer.years_experience} years experience</span><span><Check size={14} /> Certified coach</span></div>
          {user.role === 'member' && trainer.status === 'active' && <button className="secondary-button full-button" onClick={() => onBook(trainer)}>View availability <ArrowUpRight size={15} /></button>}
        </div>
      </article>)}
      {!trainers.length && <div className="panel empty-state"><Dumbbell size={22} /><b>No trainers added yet</b><span>Trainer profiles will appear here.</span></div>}</div>
    </>
  );
}

function Bookings({ bookings, role, onUpdate, onBook }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const filteredBookings = statusFilter === 'all'
    ? bookings
    : bookings.filter((booking) => booking.status === statusFilter);

  return (
    <>
      <div className="page-heading"><div><div className="eyebrow"><span /> YOUR TRAINING CALENDAR</div><h1>Sessions</h1><p>Make every session count. Keep your schedule in sync.</p></div>{role === 'member' && <button className="primary-button" onClick={onBook}><Plus size={17} /> Request a session</button>}</div>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>All sessions</h2><p>{filteredBookings.length} of {bookings.length} training {bookings.length === 1 ? 'session' : 'sessions'} in your calendar.</p></div><label className="session-status-filter">Status<select aria-label="Filter sessions by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select></label></div>
        {filteredBookings.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>SESSION</th><th>MEMBER</th><th>TRAINER</th><th>DATE & TIME</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>
          {filteredBookings.map((booking) => <tr key={booking.id}><td><span className="session-cell"><span className="session-icon"><Dumbbell size={15} /></span><span><b>{booking.specialty || 'Personal training'}</b><small>{booking.duration_minutes} min</small></span></span></td><td>{booking.member_name}</td><td>{booking.trainer_name}</td><td>{dateLabel(booking.session_date, { month: 'short', day: 'numeric', year: 'numeric' })}<small className="table-subtext">{booking.start_time?.slice(0, 5)}</small></td><td><StatusPill status={booking.status} /></td><td><BookingActions booking={booking} role={role} onUpdate={onUpdate} /></td></tr>)}
        </tbody></table></div> : <div className="empty-state"><CalendarDays size={22} /><b>{bookings.length ? `No ${statusFilter} sessions` : 'Your schedule is clear'}</b><span>{bookings.length ? 'Choose another status to see more sessions.' : 'New training sessions will appear here.'}</span></div>}
      </section>
    </>
  );
}

function BookingActions({ booking, role, onUpdate }) {
  if (booking.status === 'cancelled' || booking.status === 'completed') return <span className="muted-dash">—</span>;
  if (role === 'admin' || role === 'trainer') {
    return booking.status === 'pending'
      ? <div className="action-buttons"><button className="mini-action accept" title="Confirm session" onClick={() => onUpdate(booking.id, 'confirmed')}><Check size={15} /></button><button className="mini-action decline" title="Cancel session" onClick={() => onUpdate(booking.id, 'cancelled')}><X size={15} /></button></div>
      : <button className="mini-text-action" onClick={() => onUpdate(booking.id, 'completed')}>Mark complete</button>;
  }
  return <button className="mini-text-action cancel-action" onClick={() => onUpdate(booking.id, 'cancelled')}>Cancel</button>;
}

function Plans({ plans, user, onAdd, onEdit, onArchive }) {
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow"><span /> MEMBERSHIP OPTIONS</div><h1>{user.role === 'admin' ? 'Membership plans' : 'Find your rhythm.'}</h1><p>{user.role === 'admin' ? 'Create and update plans available to your gym members.' : 'A plan for every pace — choose the one that fits your next chapter.'}</p></div>{user.role === 'admin' && <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add a plan</button>}</div>
      <div className="plans-grid">{plans.map((plan, index) => <article className={`plan-card ${index === 1 ? 'plan-featured' : ''}`} key={plan.id}>
        {user.role === 'admin' && !plan.active ? <span className="archived-tag">ARCHIVED</span> : index === 1 && <span className="popular-tag">MOST POPULAR</span>}<div className={`plan-symbol plan-symbol-${index % 3}`}><Dumbbell size={20} /></div>
        <span className="plan-duration">{plan.duration_days === 365 ? '12 MONTHS' : `${Math.round(plan.duration_days / 30)} MONTHS`}</span><h2>{plan.name}</h2><p>{plan.description}</p>
        <div className="plan-price">{money(plan.price)}<small> / plan</small></div><div className="plan-divider" />
        <ul>{(plan.features?.length ? plan.features : defaultPlanFeatures).map((feature, featureIndex) => <li key={`${plan.id}-${featureIndex}`}><Check size={15} /> {feature}</li>)}</ul>
        {user.role === 'member' && <button className={index === 1 ? 'primary-button full-button' : 'secondary-button full-button'} onClick={() => window.alert('Please contact your gym administrator to change membership plans.')}>Choose this plan <ArrowUpRight size={15} /></button>}
        {user.role === 'admin' && <div className="plan-admin-actions"><button className="secondary-button" onClick={() => onEdit(plan)}>Edit plan</button><button className={`mini-text-action ${plan.active ? 'cancel-action' : ''}`} onClick={() => onArchive(plan)}>{plan.active ? 'Archive' : 'Restore'}</button></div>}
      </article>)}</div>
    </>
  );
}

function PlanModal({ plan, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: plan?.name || '',
    duration_days: plan?.duration_days || 30,
    price: plan?.price || '',
    description: plan?.description || '',
    features: (plan?.features?.length ? plan.features : defaultPlanFeatures).join('\n'),
  });
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return <Modal title={plan ? 'Edit membership plan' : 'Create a membership plan'} description="Set the duration, pricing, and description members will see." onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, features: form.features.split('\n').map((feature) => feature.trim()).filter(Boolean), duration_days: Number(form.duration_days), price: Number(form.price) }); }}>
      <label>Plan name<input required maxLength="100" value={form.name} onChange={change('name')} placeholder="e.g. Momentum" /></label>
      <div className="form-row"><label>Duration (days)<input type="number" required min="1" value={form.duration_days} onChange={change('duration_days')} /></label><label>Price (PHP)<input type="number" required min="0" step="0.01" value={form.price} onChange={change('price')} /></label></div>
      <label>Description<textarea required rows="3" value={form.description} onChange={change('description')} placeholder="Describe what's included." /></label>
      <label>Features <span className="optional-label">One per line</span><textarea required rows="4" value={form.features} onChange={change('features')} placeholder="Full gym floor access" /></label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button"><Check size={16} /> {plan ? 'Save changes' : 'Create plan'}</button></div>
    </form>
  </Modal>;
}

function StatusPill({ status }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={`status-pill status-${String(status).toLowerCase()}`}><i />{label}</span>;
}

function MemberModal({ member, plans, onClose, onSubmit }) {
  const [form, setForm] = useState({ name: member?.name || '', email: member?.email || '', health_conditions: member?.health_conditions || '', password: '', plan_id: plans[0]?.id || '' });
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return <Modal title={member ? 'Edit member' : 'Add a member'} description={member ? 'Update this member’s contact details and health notes.' : 'Create a member account and activate their first membership.'} onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(member ? { name: form.name, email: form.email, health_conditions: form.health_conditions } : { ...form, plan_id: Number(form.plan_id) }); }}>
      <label>Full name<input required value={form.name} onChange={change('name')} placeholder="e.g. Morgan Santiago" /></label>
      <label>Email address<input required type="email" value={form.email} onChange={change('email')} placeholder="member@example.com" /></label>
      <label>Health conditions (optional; visible to gym admins)<textarea maxLength={1000} rows={3} value={form.health_conditions} onChange={change('health_conditions')} placeholder="Relevant conditions, injuries, or limitations" /></label>
      {!member && <><label>Temporary password<input required minLength="8" type="password" value={form.password} onChange={change('password')} placeholder="At least 8 characters" /></label>
      <label>Membership plan<select required value={form.plan_id} onChange={change('plan_id')}>{plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {money(plan.price)}</option>)}</select></label></>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{member ? 'Save changes' : <><Plus size={16} /> Add member</>}</button></div>
    </form>
  </Modal>;
}

function TrainerModal({ trainer, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: trainer?.name || '',
    email: trainer?.email || '',
    password: '',
    specialty: trainer?.specialty || '',
    years_experience: trainer?.years_experience ?? 0,
    bio: trainer?.bio || '',
  });
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  return <Modal title={trainer ? 'Edit trainer' : 'Add a trainer'} description={trainer ? 'Update the trainer account and profile.' : 'Create a trainer account and profile.'} onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, years_experience: Number(form.years_experience) }); }}>
      <label>Full name<input required value={form.name} onChange={change('name')} placeholder="e.g. Morgan Santiago" /></label>
      <label>Email address<input required type="email" value={form.email} onChange={change('email')} placeholder="trainer@example.com" /></label>
      {!trainer && <label>Temporary password<input required minLength="8" type="password" value={form.password} onChange={change('password')} placeholder="At least 8 characters" /></label>}
      <label>Specialty<input required value={form.specialty} onChange={change('specialty')} placeholder="e.g. Strength & conditioning" /></label>
      <label>Years of experience<input required type="number" min="0" step="1" value={form.years_experience} onChange={change('years_experience')} /></label>
      <label>Bio<textarea required rows="3" value={form.bio} onChange={change('bio')} placeholder="Describe the trainer’s experience and approach." /></label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button">{trainer ? 'Save changes' : 'Add trainer'}</button></div>
    </form>
  </Modal>;
}

  function TrainingPlanModal({ clients, onClose, onSubmit }) {
    const [form, setForm] = useState({
      member_id: String(clients[0]?.id || ''),
      title: '',
      goal: '',
      exercises: [{ name: '', sets: 3, reps: '10' }],
    });
    const [busy, setBusy] = useState(false);
    const updateExercise = (index, field, value) => {
      setForm((current) => ({
        ...current,
        exercises: current.exercises.map((exercise, exerciseIndex) =>
          exerciseIndex === index ? { ...exercise, [field]: value } : exercise,
        ),
      }));
    };

    return <Modal title="Create a client training plan" description="Build a focused workout program for one of your clients." onClose={onClose}>
      <form className="modal-form training-plan-form" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSubmit({
            ...form,
            member_id: Number(form.member_id),
            exercises: form.exercises.map((exercise) => ({ ...exercise, sets: Number(exercise.sets) })),
          });
        } finally {
          setBusy(false);
        }
      }}>
        <label>Client<select required value={form.member_id} onChange={(event) => setForm({ ...form, member_id: event.target.value })} disabled={!clients.length}>
          {!clients.length && <option value="">No clients available</option>}
          {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
        </select></label>
        <label>Plan title<input required maxLength="120" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Strength foundations" /></label>
        <label>Training goal<textarea required rows="2" value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} placeholder="What should this plan help the client achieve?" /></label>
        <div className="training-exercise-fields">
          <div className="training-exercise-heading"><span className="form-field-label">Exercises</span><button type="button" className="text-button" disabled={form.exercises.length >= 30} onClick={() => setForm({ ...form, exercises: [...form.exercises, { name: '', sets: 3, reps: '10' }] })}><Plus size={14} /> Add exercise</button></div>
          {form.exercises.map((exercise, index) => <div className="training-exercise-input-row" key={`exercise-${index}`}>
            <label>Exercise<input required maxLength="120" value={exercise.name} onChange={(event) => updateExercise(index, 'name', event.target.value)} placeholder="e.g. Goblet squat" /></label>
            <label>Sets<input required type="number" min="1" max="50" value={exercise.sets} onChange={(event) => updateExercise(index, 'sets', event.target.value)} /></label>
            <label>Reps<input required maxLength="40" value={exercise.reps} onChange={(event) => updateExercise(index, 'reps', event.target.value)} placeholder="e.g. 8–10" /></label>
            {form.exercises.length > 1 && <button type="button" className="icon-button training-exercise-remove" aria-label={`Remove exercise ${index + 1}`} onClick={() => setForm({ ...form, exercises: form.exercises.filter((_, exerciseIndex) => exerciseIndex !== index) })}><X size={15} /></button>}
          </div>)}
        </div>
        {!clients.length && <p className="training-plan-hint">A client needs at least one session with you before you can create a plan for them.</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !clients.length}>{busy ? 'Saving…' : <><Check size={16} /> Create plan</>}</button></div>
      </form>
    </Modal>;
  }

  function BookingModal({ trainers, initialTrainerId, onClose, onSubmit }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [form, setForm] = useState({
    trainer_id: initialTrainerId || String(trainers[0]?.id || ''),
    session_date: '',
    start_time: '09:00',
    note: '',
  });
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [unavailableDates, setUnavailableDates] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState('');
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, '0')}`;
  useEffect(() => {
    if (!form.trainer_id) {
      setUnavailableDates([]);
      setAvailabilityError('');
      setAvailabilityLoading(false);
      return undefined;
    }

    let active = true;
    setAvailabilityLoading(true);
    setAvailabilityError('');
    api(`/availability?trainer_id=${encodeURIComponent(form.trainer_id)}&month=${monthKey}`)
      .then(({ unavailable_dates: dates }) => {
        if (active) setUnavailableDates(dates);
      })
      .catch((requestError) => {
        if (active) setAvailabilityError(requestError.message);
      })
      .finally(() => {
        if (active) setAvailabilityLoading(false);
      });
    return () => { active = false; };
  }, [form.trainer_id, monthKey]);

  const changeMonth = (offset) => {
    setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1));
    setForm({ ...form, session_date: '' });
  };
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const calendarDays = [
    ...Array.from({ length: monthStart.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  const firstAllowedMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(visibleMonth);
  const selectedDateLabel = form.session_date
    ? new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${form.session_date}T00:00:00`))
    : 'Select a day for your session';

  return <Modal title="Request a training session" description="Choose a trainer and preferred time. The gym will confirm your request." onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, trainer_id: Number(form.trainer_id) }); }}>
      <label>Trainer<select required value={form.trainer_id} onChange={(event) => setForm({ ...form, trainer_id: event.target.value, session_date: '' })} disabled={!trainers.length}>
        {!trainers.length && <option value="">No trainers available</option>}
        {trainers.map((trainer) => <option value={trainer.id} key={trainer.id}>{trainer.name} · {trainer.specialty}</option>)}
      </select></label>
      <div className="calendar-field">
        <div className="calendar-field-heading"><span className="form-field-label">Choose a date</span><span className="calendar-selection">{selectedDateLabel}</span></div>
        <div className="appointment-calendar" aria-label="Choose appointment date">
          <div className="calendar-month">
            <button type="button" className="calendar-nav" aria-label="Previous month" disabled={monthStart <= firstAllowedMonth} onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button>
            <strong aria-live="polite">{monthLabel}</strong>
            <button type="button" className="calendar-nav" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button>
          </div>
          <div className="calendar-grid calendar-weekdays" aria-hidden="true">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {calendarDays.map((day, index) => {
              if (!day) return <span className="calendar-empty" key={`empty-${index}`} />;
              const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
              const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const isSelected = form.session_date === dateValue;
              const isToday = dateValue === todayValue;
              const isUnavailable = unavailableDates.includes(dateValue);
              return <button
                type="button"
                key={dateValue}
                className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${isUnavailable ? 'unavailable' : ''}`}
                aria-label={`${new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date)}${isUnavailable ? ', booked' : ''}`}
                aria-pressed={isSelected}
                disabled={dateValue < todayValue || availabilityLoading || Boolean(availabilityError) || !form.trainer_id || isUnavailable}
                onClick={() => setForm({ ...form, session_date: dateValue })}
              >{day}</button>;
            })}
          </div>
          <div className="calendar-legend"><span><i className="calendar-legend-available" /> Available</span><span><i className="calendar-legend-unavailable" /> Booked</span></div>
          {availabilityLoading && <p className="calendar-message" role="status">Checking trainer availability…</p>}
          {availabilityError && <p className="calendar-message calendar-error" role="alert">Couldn’t load availability: {availabilityError}</p>}
        </div>
      </div>
      <label>Start time<input type="time" required value={form.start_time} onChange={change('start_time')} /></label>
      <label>What would you like to work on? <span className="optional-label">Optional</span><textarea rows="3" value={form.note} onChange={change('note')} placeholder="Share your goal or anything your trainer should know." /></label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!form.session_date || !form.trainer_id}><CalendarDays size={16} /> Request session</button></div>
    </form>
  </Modal>;
}

function Modal({ title, description, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div className="modal-heading"><div><h2 id="modal-title">{title}</h2><p>{description}</p></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>{children}
  </section></div>;
}

export default App;
