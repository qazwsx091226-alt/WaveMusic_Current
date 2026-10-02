(() => {
  'use strict';

  const SUPABASE_URL = '여기에_SUPABASE_PROJECT_URL';
  const SUPABASE_PUBLISHABLE_KEY = '여기에_SUPABASE_PUBLISHABLE_KEY';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let supabaseClient = null;
  let currentSession = null;
  let currentProfile = null;
  let bootFinished = false;
  let resolveReady;
  let rejectReady;

  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function configured() {
    return Boolean(
      SUPABASE_URL &&
      SUPABASE_PUBLISHABLE_KEY &&
      !SUPABASE_URL.includes('여기에_') &&
      !SUPABASE_PUBLISHABLE_KEY.includes('여기에_')
    );
  }

  function authMessage(message = '', type = '') {
    const box = $('#authMessage');
    if (!box) return;
    box.textContent = message;
    box.className = `auth-message ${type}`.trim();
  }

  function setAuthView(view) {
    const views = ['login', 'signup', 'forgot', 'recovery', 'setup'];
    views.forEach(name => {
      $(`#auth-${name}`)?.classList.toggle('hidden', name !== view);
    });

    $$('.auth-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.authTab === view);
    });

    if (view === 'forgot' || view === 'recovery' || view === 'setup') {
      $('.auth-tabs')?.classList.add('hidden');
    } else {
      $('.auth-tabs')?.classList.remove('hidden');
    }
  }

  function roleLabel(role) {
    if (role === 'super_admin') return '슈퍼관리자';
    if (role === 'admin') return '관리자';
    return '일반 사용자';
  }

  function roleClass(role) {
    if (role === 'super_admin') return 'super';
    if (role === 'admin') return 'admin';
    return 'user';
  }

  function initials(name, email) {
    const source = String(name || email || 'W').trim();
    return source.slice(0, 1).toUpperCase();
  }

  async function loadProfile(userId) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id,email,nickname,role,status,created_at')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  function unlockApp() {
    document.body.classList.remove('auth-locked');
    $('#authGate')?.classList.add('hidden');
    $('#appShell')?.removeAttribute('aria-hidden');
    updateAccountUI();
  }

  function lockApp() {
    document.body.classList.add('auth-locked');
    $('#authGate')?.classList.remove('hidden');
    $('#appShell')?.setAttribute('aria-hidden', 'true');
  }

  async function handleAuthenticated(session) {
    if (!session?.user) return false;

    try {
      const profile = await loadProfile(session.user.id);

      if (profile.status === 'suspended') {
        await supabaseClient.auth.signOut();
        currentSession = null;
        currentProfile = null;
        lockApp();
        setAuthView('login');
        authMessage('정지된 계정입니다. 관리자에게 문의해 주세요.', 'error');
        return false;
      }

      currentSession = session;
      currentProfile = profile;
      unlockApp();

      if (!bootFinished) {
        bootFinished = true;
        resolveReady({ user: session.user, profile, client: supabaseClient });
      }

      if (location.hash === '#admin' && !isAdmin()) {
        location.hash = '#home';
      }

      return true;
    } catch (error) {
      console.error('프로필 불러오기 실패:', error);
      lockApp();
      setAuthView('login');
      authMessage('계정 정보를 불러오지 못했습니다. Supabase 설정을 확인해 주세요.', 'error');
      return false;
    }
  }

  function updateAccountUI() {
    if (!currentProfile || !currentSession?.user) return;

    const nickname = currentProfile.nickname || 'Wave 사용자';
    const email = currentProfile.email || currentSession.user.email || '';
    const role = currentProfile.role || 'user';

    const avatar = initials(nickname, email);

    if ($('#accountAvatar')) $('#accountAvatar').textContent = avatar;
    if ($('#accountName')) $('#accountName').textContent = nickname;
    if ($('#accountEmail')) $('#accountEmail').textContent = email;
    if ($('#accountMenuName')) $('#accountMenuName').textContent = nickname;
    if ($('#accountMenuEmail')) $('#accountMenuEmail').textContent = email;
    if ($('#accountMenuAvatar')) $('#accountMenuAvatar').textContent = avatar;

    const badge = $('#accountRoleBadge');
    if (badge) {
      badge.textContent = roleLabel(role);
      badge.className = `role-badge ${roleClass(role)}`;
    }

    $('#adminNavItem')?.classList.toggle('hidden', !isAdmin());
    $('#accountAdminLink')?.classList.toggle('hidden', !isAdmin());

    const profileRole = $('#profileRoleText');
    if (profileRole) profileRole.textContent = roleLabel(role);
    const profileEmail = $('#profileEmailText');
    if (profileEmail) profileEmail.textContent = email;
    const profileNickname = $('#profileNicknameInput');
    if (profileNickname) profileNickname.value = nickname;
  }

  function isAdmin() {
    return currentProfile?.role === 'admin' || currentProfile?.role === 'super_admin';
  }

  function isSuperAdmin() {
    return currentProfile?.role === 'super_admin';
  }

  function openAccountMenu() {
    $('#accountMenu')?.classList.toggle('hidden');
  }

  function closeAccountMenu() {
    $('#accountMenu')?.classList.add('hidden');
  }

  function openProfileModal() {
    closeAccountMenu();
    updateAccountUI();
    $('#profileModal')?.classList.remove('hidden');
  }

  function closeProfileModal() {
    $('#profileModal')?.classList.add('hidden');
  }

  async function refreshAdminPanel() {
    if (!isAdmin()) return;

    const table = $('#adminUsersBody');
    if (table) {
      table.innerHTML = '<tr><td colspan="6" class="admin-loading">사용자 정보를 불러오는 중...</td></tr>';
    }

    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id,email,nickname,role,status,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      if (table) table.innerHTML = '<tr><td colspan="6" class="admin-loading">사용자 목록을 불러오지 못했습니다.</td></tr>';
      return;
    }

    const users = data || [];
    const active = users.filter(user => user.status === 'active').length;
    const suspended = users.filter(user => user.status === 'suspended').length;
    const admins = users.filter(user => user.role === 'admin' || user.role === 'super_admin').length;

    if ($('#adminTotalUsers')) $('#adminTotalUsers').textContent = String(users.length);
    if ($('#adminActiveUsers')) $('#adminActiveUsers').textContent = String(active);
    if ($('#adminSuspendedUsers')) $('#adminSuspendedUsers').textContent = String(suspended);
    if ($('#adminCount')) $('#adminCount').textContent = String(admins);

    renderAdminUsers(users);
  }

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function renderAdminUsers(users) {
    const body = $('#adminUsersBody');
    if (!body) return;

    const query = String($('#adminUserSearch')?.value || '').trim().toLowerCase();
    const filtered = users.filter(user => {
      if (!query) return true;
      return [user.nickname, user.email, user.role, user.status]
        .some(value => String(value || '').toLowerCase().includes(query));
    });

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="6" class="admin-loading">검색 결과가 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map(user => {
      const self = user.id === currentSession?.user?.id;
      const canStatus = !self && user.role !== 'super_admin' && (isSuperAdmin() || user.role === 'user');
      const canRole = isSuperAdmin() && !self && user.role !== 'super_admin';
      const statusButtonText = user.status === 'active' ? '정지' : '정지 해제';
      const nextStatus = user.status === 'active' ? 'suspended' : 'active';
      const roleButtonText = user.role === 'admin' ? '관리자 해제' : '관리자 승격';
      const nextRole = user.role === 'admin' ? 'user' : 'admin';

      return `
        <tr>
          <td>
            <div class="admin-user-main">
              <strong>${escapeHTML(user.nickname || '이름 없음')}</strong>
              <span>${escapeHTML(user.email || '')}</span>
            </div>
          </td>
          <td><span class="role-badge ${roleClass(user.role)}">${roleLabel(user.role)}</span></td>
          <td><span class="status-badge ${user.status === 'active' ? 'active' : 'suspended'}">${user.status === 'active' ? '정상' : '정지'}</span></td>
          <td>${user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-'}</td>
          <td>${self ? '<span class="admin-self">내 계정</span>' : ''}</td>
          <td>
            <div class="admin-row-actions">
              ${canStatus ? `<button class="admin-mini-button ${nextStatus === 'suspended' ? 'danger' : ''}" data-admin-status="${user.id}" data-next-status="${nextStatus}" type="button">${statusButtonText}</button>` : ''}
              ${canRole ? `<button class="admin-mini-button" data-admin-role="${user.id}" data-next-role="${nextRole}" type="button">${roleButtonText}</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    $$('[data-admin-status]', body).forEach(button => {
      button.addEventListener('click', async () => {
        const target = button.dataset.adminStatus;
        const newStatus = button.dataset.nextStatus;
        const action = newStatus === 'suspended' ? '정지' : '정지 해제';
        if (!confirm(`이 계정을 ${action}할까요?`)) return;

        button.disabled = true;
        const { error } = await supabaseClient.rpc('admin_set_user_status', {
          target_user: target,
          new_status: newStatus
        });
        button.disabled = false;

        if (error) {
          alert(`처리 실패: ${error.message}`);
          return;
        }

        await refreshAdminPanel();
      });
    });

    $$('[data-admin-role]', body).forEach(button => {
      button.addEventListener('click', async () => {
        const target = button.dataset.adminRole;
        const newRole = button.dataset.nextRole;
        const action = newRole === 'admin' ? '관리자로 승격' : '일반 사용자로 변경';
        if (!confirm(`이 사용자를 ${action}할까요?`)) return;

        button.disabled = true;
        const { error } = await supabaseClient.rpc('super_set_user_role', {
          target_user: target,
          new_role: newRole
        });
        button.disabled = false;

        if (error) {
          alert(`권한 변경 실패: ${error.message}`);
          return;
        }

        await refreshAdminPanel();
      });
    });
  }

  async function boot() {
    lockApp();

    if (!configured()) {
      setAuthView('setup');
      authMessage('Supabase 연결 정보가 아직 입력되지 않았습니다.', 'error');
      return;
    }

    if (!window.supabase?.createClient) {
      setAuthView('setup');
      authMessage('Supabase 라이브러리를 불러오지 못했습니다.', 'error');
      return;
    }

    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        currentSession = session;
        lockApp();
        setAuthView('recovery');
        authMessage('새 비밀번호를 입력해 주세요.');
        return;
      }

      if (event === 'SIGNED_OUT') {
        currentSession = null;
        currentProfile = null;
        lockApp();
        setAuthView('login');
        updateAccountUI();
        return;
      }

      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        setTimeout(() => handleAuthenticated(session), 0);
      }
    });

    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.error(error);

    if (session) {
      await handleAuthenticated(session);
    } else {
      setAuthView('login');
      authMessage('');
    }
  }

  function bindUI() {
    $$('.auth-tab').forEach(button => {
      button.addEventListener('click', () => {
        authMessage('');
        setAuthView(button.dataset.authTab);
      });
    });

    $('#goForgotPassword')?.addEventListener('click', () => {
      authMessage('');
      setAuthView('forgot');
    });

    $('#backToLogin')?.addEventListener('click', () => {
      authMessage('');
      setAuthView('login');
    });

    $('#loginForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      authMessage('로그인 중...');

      const email = $('#loginEmail')?.value.trim();
      const password = $('#loginPassword')?.value || '';
      const button = $('#loginSubmit');
      if (button) button.disabled = true;

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (button) button.disabled = false;

      if (error) {
        authMessage('이메일 또는 비밀번호를 확인해 주세요.', 'error');
        return;
      }

      await handleAuthenticated(data.session);
    });

    $('#signupForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      authMessage('회원가입 처리 중...');

      const nickname = $('#signupNickname')?.value.trim();
      const email = $('#signupEmail')?.value.trim();
      const password = $('#signupPassword')?.value || '';
      const confirmPassword = $('#signupPasswordConfirm')?.value || '';

      if (!nickname || nickname.length < 2 || nickname.length > 24) {
        authMessage('닉네임은 2~24자로 입력해 주세요.', 'error');
        return;
      }

      if (password.length < 8) {
        authMessage('비밀번호는 8자 이상으로 입력해 주세요.', 'error');
        return;
      }

      if (password !== confirmPassword) {
        authMessage('비밀번호 확인이 일치하지 않습니다.', 'error');
        return;
      }

      const button = $('#signupSubmit');
      if (button) button.disabled = true;

      const redirectTo = `${location.origin}${location.pathname}`;
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { nickname },
          emailRedirectTo: redirectTo
        }
      });

      if (button) button.disabled = false;

      if (error) {
        authMessage(error.message, 'error');
        return;
      }

      if (data.session) {
        await handleAuthenticated(data.session);
      } else {
        setAuthView('login');
        authMessage('회원가입이 완료되었습니다. 이메일 인증 링크를 확인한 뒤 로그인해 주세요.', 'success');
      }
    });

    $('#forgotForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const email = $('#forgotEmail')?.value.trim();
      const button = $('#forgotSubmit');
      if (button) button.disabled = true;
      authMessage('비밀번호 재설정 메일을 보내는 중...');

      const redirectTo = `${location.origin}${location.pathname}`;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
      if (button) button.disabled = false;

      if (error) {
        authMessage(error.message, 'error');
        return;
      }

      authMessage('재설정 링크를 이메일로 보냈습니다. 메일함을 확인해 주세요.', 'success');
    });

    $('#recoveryForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const password = $('#recoveryPassword')?.value || '';
      const confirmPassword = $('#recoveryPasswordConfirm')?.value || '';

      if (password.length < 8) {
        authMessage('새 비밀번호는 8자 이상이어야 합니다.', 'error');
        return;
      }
      if (password !== confirmPassword) {
        authMessage('비밀번호 확인이 일치하지 않습니다.', 'error');
        return;
      }

      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        authMessage(error.message, 'error');
        return;
      }

      authMessage('비밀번호가 변경되었습니다. 잠시 후 사이트로 이동합니다.', 'success');
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) setTimeout(() => handleAuthenticated(session), 500);
    });

    $('#accountButton')?.addEventListener('click', event => {
      event.stopPropagation();
      openAccountMenu();
    });

    document.addEventListener('click', event => {
      if (!event.target.closest('.account-area')) closeAccountMenu();
    });

    $('#accountProfileLink')?.addEventListener('click', openProfileModal);

    $('#accountAdminLink')?.addEventListener('click', () => {
      closeAccountMenu();
      if (!isAdmin()) return;
      location.hash = '#admin';
      setTimeout(refreshAdminPanel, 50);
    });

    $('#accountLogout')?.addEventListener('click', async () => {
      closeAccountMenu();
      await supabaseClient.auth.signOut();
      location.hash = '#home';
      location.reload();
    });

    $('#profileModalClose')?.addEventListener('click', closeProfileModal);
    $('#profileModal')?.addEventListener('click', event => {
      if (event.target.id === 'profileModal') closeProfileModal();
    });

    $('#profileNicknameForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const nickname = $('#profileNicknameInput')?.value.trim();
      if (!nickname || nickname.length < 2 || nickname.length > 24) {
        $('#profileMessage').textContent = '닉네임은 2~24자로 입력해 주세요.';
        return;
      }

      const { error } = await supabaseClient.rpc('update_my_nickname', { new_nickname: nickname });
      if (error) {
        $('#profileMessage').textContent = error.message;
        return;
      }

      currentProfile = await loadProfile(currentSession.user.id);
      updateAccountUI();
      $('#profileMessage').textContent = '닉네임을 변경했습니다.';
    });

    $('#profilePasswordForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const password = $('#profileNewPassword')?.value || '';
      const confirmPassword = $('#profileNewPasswordConfirm')?.value || '';

      if (password.length < 8) {
        $('#profileMessage').textContent = '비밀번호는 8자 이상이어야 합니다.';
        return;
      }
      if (password !== confirmPassword) {
        $('#profileMessage').textContent = '비밀번호 확인이 일치하지 않습니다.';
        return;
      }

      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        $('#profileMessage').textContent = error.message;
        return;
      }

      $('#profileNewPassword').value = '';
      $('#profileNewPasswordConfirm').value = '';
      $('#profileMessage').textContent = '비밀번호를 변경했습니다.';
    });

    $('#adminRefreshBtn')?.addEventListener('click', refreshAdminPanel);
    $('#adminUserSearch')?.addEventListener('input', refreshAdminPanel);

    window.addEventListener('hashchange', () => {
      if (location.hash === '#admin' && isAdmin()) {
        setTimeout(refreshAdminPanel, 50);
      }
    });
  }

  window.WaveAuth = {
    requireSession() {
      return readyPromise;
    },
    get client() {
      return supabaseClient;
    },
    get session() {
      return currentSession;
    },
    get profile() {
      return currentProfile;
    },
    isAdmin,
    isSuperAdmin,
    refreshAdminPanel
  };

  bindUI();
  boot().catch(error => {
    console.error(error);
    lockApp();
    setAuthView('login');
    authMessage('로그인 시스템 초기화 중 오류가 발생했습니다.', 'error');
    if (!bootFinished && rejectReady) rejectReady(error);
  });
})();
