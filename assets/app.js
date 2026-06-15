const cfg = window.BETA_CONFIG || {};
const $ = (id) => document.getElementById(id);

const state = {
  client: null,
  session: null,
  profile: null,
  students: [],
  questions: [],
  questionCatalog: [],
  assignments: [],
  submissions: [],
  feedbacks: [],
  aiFeedbacks: [],
  notifications: [],
  paymentRequests: [],
  entitlements: [],
  currentAssignment: null,
  currentReviewSubmission: null,
  studentView: 'library',
  libraryCategory: '',
  studentHistoryIndex: 0,
  messageDrawerOpen: false,
  writerStartedAt: null,
  writerTimer: null
};

function showStatus(message, tone = '') {
  const box = $('statusBox');
  box.className = `status ${tone}`;
  box.textContent = message || '';
}

function showAuthNotice(message) {
  $('authNotice').textContent = message || '';
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function shortId(id) {
  return String(id || '').slice(0, 8);
}

function ensureConfigured() {
  return cfg.supabaseUrl
    && cfg.supabasePublishableKey
    && !cfg.supabaseUrl.includes('YOUR-PROJECT')
    && !cfg.supabasePublishableKey.includes('YOUR-SUPABASE');
}

async function init() {
  $('appName').textContent = cfg.appName || 'TOEFL Writing Beta';
  bindEvents();

  if (!ensureConfigured()) {
    showAuthNotice('请先编辑 config.js，填入 Supabase URL 和 publishable key。');
    return;
  }

  state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  state.client.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    bootSession();
  });
  await bootSession();
}

function bindEvents() {
  $('studentLoginBtn').addEventListener('click', () => login('student'));
  $('teacherLoginBtn').addEventListener('click', () => login('teacher'));
  $('studentRegisterModeBtn').addEventListener('click', showStudentRegister);
  $('backToLoginBtn').addEventListener('click', showLogin);
  $('registerBtn').addEventListener('click', registerStudent);
  $('logoutBtn').addEventListener('click', logout);
  $('refreshStudentBtn').addEventListener('click', loadStudentDashboard);
  $('refreshTeacherBtn').addEventListener('click', loadTeacherDashboard);
  $('saveDraftBtn').addEventListener('click', saveDraft);
  $('submitEssayBtn').addEventListener('click', submitEssay);
  $('backToLibraryBtn').addEventListener('click', () => setStudentView('library'));
  $('essayInput').addEventListener('input', handleEssayInput);
  $('createPaymentRequestBtn').addEventListener('click', createPaymentRequest);
  $('createAssignmentBtn').addEventListener('click', createAssignment);
  $('grantEntitlementBtn').addEventListener('click', grantEntitlement);
  $('closeReviewBtn').addEventListener('click', closeReview);
  $('publishFeedbackBtn').addEventListener('click', publishFeedback);
  $('closeMessagesBtn').addEventListener('click', closeMessages);
  $('messageDrawerBackdrop').addEventListener('click', (event) => {
    if (event.target === $('messageDrawerBackdrop')) closeMessages();
  });
}

function showStudentRegister() {
  $('loginForm').classList.add('hidden');
  $('studentRegisterForm').classList.remove('hidden');
  showAuthNotice('');
}

function showLogin() {
  $('studentRegisterForm').classList.add('hidden');
  $('loginForm').classList.remove('hidden');
  showAuthNotice('');
}

async function bootSession() {
  clearInterval(state.writerTimer);
  state.currentAssignment = null;

  if (!state.session) {
    state.profile = null;
    $('authView').classList.remove('hidden');
    $('appView').classList.add('hidden');
    $('logoutBtn').classList.add('hidden');
    $('nav').innerHTML = '';
    $('userLine').textContent = '未登录';
    closeMessages();
    return;
  }

  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');

  await loadProfile();
  renderNav();
  $('userLine').textContent = `${state.profile.display_name || state.session.user.email} · ${state.profile.role}`;

  if (state.profile.role === 'teacher') {
    await loadTeacherDashboard();
  } else {
    await loadStudentDashboard();
  }
}

async function loadProfile() {
  const { data, error } = await state.client
    .from('profiles')
    .select('*')
    .eq('id', state.session.user.id)
    .single();

  if (error) throw error;
  state.profile = data;
}

function renderNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  const role = state.profile?.role;
  if (role === 'teacher') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'active';
    btn.textContent = '教师端';
    nav.appendChild(btn);
    return;
  }

  const unreadCount = state.notifications.filter((item) => !item.read_at).length;
  [
    ['library', '题库'],
    ['history', '历史'],
    ['payments', '升级']
  ].forEach(([view, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.studentView === view ? 'active' : '';
    btn.textContent = label;
    btn.addEventListener('click', () => setStudentView(view));
    nav.appendChild(btn);
  });

  const messageBtn = document.createElement('button');
  messageBtn.type = 'button';
  messageBtn.className = state.messageDrawerOpen ? 'active' : '';
  messageBtn.textContent = unreadCount ? `消息 ${unreadCount}` : '消息';
  messageBtn.addEventListener('click', toggleMessages);
  nav.appendChild(messageBtn);
}

async function login(role) {
  showAuthNotice('');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const { error } = await state.client.auth.signInWithPassword({ email, password });
  if (error) {
    showAuthNotice(error.message);
    return;
  }

  await waitForProfileRole(role);
  if (state.profile?.role && state.profile.role !== role) {
    await state.client.auth.signOut();
    showAuthNotice(role === 'teacher' ? '这个账号不是教师账号。' : '这个账号不是学生账号。');
  }
}

async function waitForProfileRole(expectedRole) {
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  if (!state.session) return;
  await loadProfile();
  return state.profile?.role === expectedRole;
}

async function registerStudent() {
  showAuthNotice('');
  const displayName = $('registerName').value.trim();
  const email = $('registerEmail').value.trim();
  const password = $('registerPassword').value;
  const { error } = await state.client.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || email } }
  });
  if (error) {
    showAuthNotice(error.message);
  } else {
    showAuthNotice('注册成功。如果开启了邮箱确认，请先查收邮件。');
  }
}

async function logout() {
  await state.client.auth.signOut();
}

function renderPrompt(question) {
  if (!question) return '';
  const payload = question.prompt_payload || {};
  if (question.type === 'academic') {
    const professor = payload.professor || {};
    const students = payload.students || [];
    return `
      <div><b>${escapeHtml(professor.name || 'Professor')}</b></div>
      <p>${escapeHtml(professor.text || '')}</p>
      ${students.map((student) => `
        <p><b>${escapeHtml(student.name)}:</b> ${escapeHtml(student.text)}</p>
      `).join('')}
    `;
  }
  return `
    <div><b>To:</b> ${escapeHtml(payload.recipient || '')}</div>
    <div><b>Subject:</b> ${escapeHtml(payload.subject || '')}</div>
    <p>${escapeHtml(payload.context || '')}</p>
    <ul>${(payload.bullets || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  `;
}

async function loadStudentDashboard() {
  showStatus('正在加载学生端数据...');
  $('studentDashboard').classList.remove('hidden');
  $('teacherDashboard').classList.add('hidden');

  const userId = state.session.user.id;

  const [assignmentsRes, submissionsRes, feedbacksRes, aiRes, inboxRes, payRes, entRes, catalogRes] = await Promise.all([
    state.client.from('assignments').select('*, questions(*)').eq('student_id', userId).eq('status', 'published').order('created_at', { ascending: false }),
    state.client.from('submissions').select('*, questions(*)').eq('student_id', userId).order('created_at', { ascending: false }),
    state.client.from('teacher_feedbacks').select('*').eq('published', true).order('created_at', { ascending: false }),
    state.client.from('ai_feedbacks').select('*').eq('student_id', userId).order('created_at', { ascending: false }),
    state.client.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
    state.client.from('payment_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    state.client.from('entitlements').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    state.client.from('question_catalog').select('*').order('source_date', { ascending: false }).order('import_index', { ascending: false })
  ]);

  if (assignmentsRes.error) throw assignmentsRes.error;
  if (submissionsRes.error) throw submissionsRes.error;
  if (feedbacksRes.error) throw feedbacksRes.error;
  if (aiRes.error) throw aiRes.error;
  if (inboxRes.error) throw inboxRes.error;
  if (payRes.error) throw payRes.error;
  if (entRes.error) throw entRes.error;
  if (catalogRes.error) throw catalogRes.error;

  state.assignments = assignmentsRes.data || [];
  state.submissions = submissionsRes.data || [];
  state.feedbacks = feedbacksRes.data || [];
  state.aiFeedbacks = aiRes.data || [];
  state.notifications = inboxRes.data || [];
  state.paymentRequests = payRes.data || [];
  state.entitlements = entRes.data || [];
  state.questionCatalog = catalogRes.data || [];

  const entitledQuestionIds = Array.from(unlockedQuestionIds())
    .filter((id) => !state.assignments.some((assignment) => assignment.question_id === id));
  let entitledQuestions = [];
  if (entitledQuestionIds.length) {
    const { data, error } = await state.client
      .from('questions')
      .select('*')
      .in('id', entitledQuestionIds);
    if (error) throw error;
    entitledQuestions = data || [];
  }

  state.questions = uniqueQuestionRows([
    ...uniqueQuestionsFromAssignments(state.assignments),
    ...state.submissions.map((item) => item.questions).filter(Boolean),
    ...entitledQuestions
  ]);

  renderNav();
  renderStudentStats();
  renderStudentAssignments();
  renderStudentHistory();
  renderStudentInbox();
  renderStudentPayments();
  setStudentView(state.studentView);
  showStatus('');
}

function setStudentView(view) {
  state.studentView = view;
  const isWriting = view === 'writing';
  $('studentPanelHead').classList.toggle('hidden', isWriting);
  $('studentStats').classList.toggle('hidden', isWriting);
  $('studentLibraryView').classList.toggle('hidden', view !== 'library');
  $('studentHistoryView').classList.toggle('hidden', view !== 'history');
  $('studentPaymentsView').classList.toggle('hidden', view !== 'payments');
  $('studentWritingView').classList.toggle('hidden', view !== 'writing');
  if (view !== 'writing') {
    clearInterval(state.writerTimer);
  }
  renderNav();
}

window.setStudentView = setStudentView;

function renderStudentStats() {
  const submittedAssignmentIds = new Set(state.submissions.map((item) => item.assignment_id));
  const unlockedCount = unlockedQuestionIds().size;
  const aiCredits = state.entitlements
    .filter((item) => item.entitlement_type === 'ai_feedback')
    .reduce((sum, item) => sum + Number(item.remaining_uses || 0), 0);
  const feedbackCount = state.feedbacks.length + state.aiFeedbacks.filter((item) => item.status === 'completed').length;
  $('studentStats').innerHTML = `
    <div class="stat">已解锁题目<b>${unlockedCount}</b></div>
    <div class="stat">已提交<b>${state.submissions.length}</b></div>
    <div class="stat">已完成题目<b>${submittedAssignmentIds.size}</b></div>
    <div class="stat">AI 次数<b>${aiCredits}</b></div>
    <div class="stat">反馈记录<b>${feedbackCount}</b></div>
  `;
}

function renderStudentAssignments() {
  const box = $('studentAssignments');
  const catalog = questionCatalogRows();
  if (!catalog.length) {
    box.innerHTML = '<div class="empty-state">暂无题库内容。</div>';
    return;
  }

  if (!state.libraryCategory) {
    box.innerHTML = renderQuestionCategoryHome();
    return;
  }

  box.innerHTML = renderQuestionCategoryDetail(state.libraryCategory, catalog);
}

function uniqueQuestionsFromAssignments(assignments) {
  return uniqueQuestionRows(assignments
    .map((item) => item.questions)
    .filter(Boolean));
}

function uniqueQuestionRows(questions) {
  const seen = new Set();
  return questions
    .filter((question) => {
      if (!question || seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    })
    .sort(compareQuestionRows);
}

function questionCatalogRows() {
  const rows = new Map();
  state.questionCatalog.forEach((question) => rows.set(question.id, question));
  state.questions.forEach((question) => {
    if (!rows.has(question.id)) rows.set(question.id, questionCatalogItem(question));
  });
  return Array.from(rows.values()).sort(compareQuestionRows);
}

function questionCatalogItem(question) {
  return {
    id: question.id,
    import_index: question.import_index,
    type: question.type,
    source_date: question.source_date,
    source_raw: question.source_raw,
    is_active: question.is_active
  };
}

function compareQuestionRows(a, b) {
  const dateCompare = String(b.source_date || '').localeCompare(String(a.source_date || ''));
  if (dateCompare) return dateCompare;
  return Number(b.import_index || 0) - Number(a.import_index || 0);
}

function unlockedQuestionIds() {
  const ids = new Set();
  state.assignments.forEach((assignment) => {
    if (assignment.question_id) ids.add(assignment.question_id);
  });
  state.entitlements.forEach((entitlement) => {
    if (entitlement.entitlement_type === 'question' && entitlement.question_id) ids.add(entitlement.question_id);
  });
  return ids;
}

function renderQuestionCategoryHome() {
  const cards = [
    ['email', 'Email 写作'],
    ['academic', 'Academic Discussion']
  ].map(([type, label]) => `
    <button class="category-card ${type === 'email' ? 'email' : 'academic'}" type="button" onclick="openQuestionCategory('${type}')">
      <span class="auth-card-label">${type === 'email' ? 'Email' : 'Academic'}</span>
      <strong>${label}</strong>
    </button>
  `).join('');
  return `<div class="category-home">${cards}</div>`;
}

window.openQuestionCategory = function openQuestionCategory(type) {
  state.libraryCategory = type;
  renderStudentAssignments();
};

window.closeQuestionCategory = function closeQuestionCategory() {
  state.libraryCategory = '';
  renderStudentAssignments();
};

function renderQuestionCategoryDetail(type, questions) {
  const label = type === 'email' ? 'Email 写作' : 'Academic Discussion';
  const typedQuestions = questions.filter((question) => question.type === type);
  const unlockedIds = unlockedQuestionIds();
  const unlocked = state.questions
    .filter((question) => question.type === type && unlockedIds.has(question.id))
    .sort(compareQuestionRows);
  const locked = typedQuestions.filter((question) => !unlockedIds.has(question.id));
  return `
    <section class="category-detail">
      <div class="category-detail-head">
        <button class="ghost" type="button" onclick="closeQuestionCategory()">返回题库</button>
        <div>
          <div class="auth-card-label">${type === 'email' ? 'Email' : 'Academic'}</div>
          <h3>${label}</h3>
        </div>
        <div class="library-counts">
          <span>已解锁 ${unlocked.length}</span>
          <span>待解锁 ${locked.length}</span>
        </div>
      </div>
      <div class="unlock-group">
        <h4>已解锁</h4>
        <div class="question-grid compact-grid">
          ${unlocked.length ? unlocked.map(renderUnlockedQuestionCard).join('') : '<div class="empty-state compact-empty">暂无已解锁题目。</div>'}
        </div>
      </div>
      <div class="unlock-group">
        <h4>未解锁</h4>
        <div class="locked-card-stack">
          ${locked.length ? renderLockedQuestionCards(locked) : '<div class="empty-state compact-empty">暂无待解锁题目。</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderUnlockedQuestionCard(question) {
  const assignment = state.assignments.find((item) => item.question_id === question.id);
  const submissions = state.submissions.filter((item) => item.question_id === question.id);
  const lastSubmission = submissions[0];
  const draftKeyValue = assignment ? draftKey(assignment.id) : questionDraftKey(question.id);
  const hasDraft = Boolean(localStorage.getItem(draftKeyValue));
  const practiceLabel = hasDraft ? '继续写作' : submissions.length ? '重新练习' : '开始写作';
  return `
    <article class="question-card ${question.type === 'email' ? 'email' : 'academic'}">
      <div class="card-topline">
        <span class="badge">已解锁</span>
        <span>${Math.round((question.time_limit_seconds || 0) / 60)} min</span>
        <span>${questionSetLabel(question)}</span>
      </div>
      <div class="item-title">${escapeHtml(question.title || 'Untitled')}</div>
      <p class="card-summary">${questionSummary(question)}</p>
      <div class="meta">
        ${submissions.length ? `<span>${submissions.length} 次提交</span>` : '<span>未提交</span>'}
        ${lastSubmission ? `<span>上次 ${lastSubmission.word_count} words</span>` : ''}
        ${assignment?.allow_ai_feedback ? '<span class="badge">可用 AI</span>' : ''}
        ${hasDraft ? '<span class="badge draft">有草稿</span>' : ''}
      </div>
      <div class="item-actions">
        <button type="button" onclick="restartPractice('${question.id}', '${assignment?.id || ''}')">${practiceLabel}</button>
        ${submissions.length ? `<button type="button" class="secondary" onclick="openStudentSubmissionDetail('${lastSubmission.id}')">查看历史</button>` : ''}
      </div>
    </article>
  `;
}

function renderLockedQuestionCards(questions) {
  const groups = new Map();
  questions.forEach((question) => {
    const label = questionSetLabel(question);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(question);
  });

  return Array.from(groups.entries()).map(([label, rows], index) => {
    const primary = rows[0];
    return `
      <article class="locked-stack-card ${primary.type === 'email' ? 'email' : 'academic'}" style="--stack-offset:${index % 4};">
        <div class="card-topline">
          <span class="badge">待解锁</span>
          <span class="locked-visible-date">${escapeHtml(label)}</span>
        </div>
        <div class="locked-glass-panel" aria-hidden="true">
          <div class="locked-placeholder locked-placeholder-title"></div>
          <div class="locked-placeholder"></div>
          <div class="locked-placeholder short"></div>
        </div>
        <div class="locked-card-foot">
          <span>题目内容已隐藏</span>
          <button class="secondary" type="button" onclick="prefillUpgradeRequest('${primary.id}')">升级解锁</button>
        </div>
      </article>
    `;
  }).join('');
}

function questionSetLabel(question) {
  const raw = String(question.source_raw || '').trim();
  const date = question.source_date || (raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'Unknown date');
  const setMatch = raw.match(/([ABC])\s*卷|(\d{4}-\d{2}-\d{2})([ABC])/i);
  const set = setMatch?.[1] || setMatch?.[3] || '';
  return `${date}${set ? ` ${set.toUpperCase()}卷` : ''}`;
}

function questionDraftKey(questionId) {
  return `beta_draft_${state.session.user.id}_question_${questionId}`;
}

function questionSummary(question) {
  const payload = question?.prompt_payload || {};
  const text = question?.type === 'academic'
    ? payload.professor?.text
    : payload.context;
  return escapeHtml(String(text || '').slice(0, 180) + (String(text || '').length > 180 ? '...' : ''));
}

window.startAssignment = function startAssignment(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  setStudentView('writing');
  state.currentAssignment = assignment;
  state.writerStartedAt = Date.now();
  $('writingTitle').textContent = assignment.questions?.title || '写作练习';
  $('studentPrompt').innerHTML = renderPrompt(assignment.questions);
  $('essayInput').value = localStorage.getItem(draftKey(assignment.id)) || '';
  updateWriterMeta();
  clearInterval(state.writerTimer);
  state.writerTimer = setInterval(updateWriterMeta, 1000);
  $('essayInput').focus();
};

window.startUnlockedQuestion = function startUnlockedQuestion(questionId) {
  const question = state.questions.find((item) => item.id === questionId)
    || state.submissions.find((item) => item.question_id === questionId)?.questions;
  if (!question) {
    showStatus('这道题尚未解锁，暂时不能练习。', 'warning');
    return;
  }
  setStudentView('writing');
  state.currentAssignment = {
    id: null,
    question_id: question.id,
    questions: question,
    allow_ai_feedback: false,
    unlocked_direct: true
  };
  state.writerStartedAt = Date.now();
  $('writingTitle').textContent = question.title || '写作练习';
  $('studentPrompt').innerHTML = renderPrompt(question);
  $('essayInput').value = localStorage.getItem(questionDraftKey(question.id)) || '';
  updateWriterMeta();
  clearInterval(state.writerTimer);
  state.writerTimer = setInterval(updateWriterMeta, 1000);
  $('essayInput').focus();
};

window.restartPractice = function restartPractice(questionId, assignmentId = '') {
  $('studentHistoryDetail').classList.add('hidden');
  if (assignmentId) window.startAssignment(assignmentId);
  else window.startUnlockedQuestion(questionId);
};

function draftKey(assignmentId) {
  return `beta_draft_${state.session.user.id}_${assignmentId}`;
}

function currentDraftKey() {
  if (!state.currentAssignment) return '';
  return state.currentAssignment.id
    ? draftKey(state.currentAssignment.id)
    : questionDraftKey(state.currentAssignment.question_id);
}

function handleEssayInput() {
  updateWriterMeta();
  if (state.currentAssignment) {
    localStorage.setItem(currentDraftKey(), $('essayInput').value);
  }
}

function updateWriterMeta() {
  const essay = $('essayInput').value;
  $('wordCount').textContent = `${wordCount(essay)} words`;
  const seconds = state.writerStartedAt ? Math.floor((Date.now() - state.writerStartedAt) / 1000) : 0;
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  $('timerText').textContent = `${m}:${s}`;
}

function saveDraft() {
  if (!state.currentAssignment) return;
  localStorage.setItem(currentDraftKey(), $('essayInput').value);
  showStatus('草稿已保存在本机。');
}

async function submitEssay() {
  const assignment = state.currentAssignment;
  const essay = $('essayInput').value.trim();
  if (!assignment) return;
  if (wordCount(essay) < 10) {
    showStatus('作文太短，至少写 10 个词后再提交。', 'warning');
    return;
  }

  const seconds = state.writerStartedAt ? Math.floor((Date.now() - state.writerStartedAt) / 1000) : 0;
  const { error } = await state.client.from('submissions').insert({
    assignment_id: assignment.id || null,
    question_id: assignment.question_id,
    student_id: state.session.user.id,
    essay,
    word_count: wordCount(essay),
    time_used_seconds: seconds,
    status: 'submitted'
  });

  if (error) {
    showStatus(error.message, 'danger');
    return;
  }

  localStorage.removeItem(currentDraftKey());
  $('essayInput').value = '';
  setStudentView('history');
  showStatus('已提交。');
  await loadStudentDashboard();
}

function renderStudentHistory() {
  const box = $('studentHistoryDeck');
  const controls = $('studentHistoryControls');
  if (!state.submissions.length) {
    box.innerHTML = '<div class="empty-state">暂无历史习作。</div>';
    controls.innerHTML = '';
    $('studentHistoryDetail').classList.add('hidden');
    return;
  }

  if (state.studentHistoryIndex >= state.submissions.length) state.studentHistoryIndex = 0;

  const visibleOffsets = Array.from({ length: Math.min(3, state.submissions.length) }, (_, index) => index);
  box.innerHTML = visibleOffsets.map((offset) => {
    const index = state.studentHistoryIndex + offset;
    if (index >= state.submissions.length) return '';
    const submission = state.submissions[index];
    const teacherFeedback = state.feedbacks.find((item) => item.submission_id === submission.id);
    const aiFeedback = state.aiFeedbacks.find((item) => item.submission_id === submission.id && item.status === 'completed');
    const cls = offset === 0 ? 'is-top' : offset === 1 ? 'is-second' : 'is-third';
    return `
      <article class="history-card ${cls}">
        <div class="history-card-head">
          <div>
            <div class="card-topline">
              <span class="badge">${escapeHtml(submission.questions?.type || 'practice')}</span>
              <span>${formatDate(submission.created_at)}</span>
            </div>
            <div class="item-title">${escapeHtml(submission.questions?.title || 'Submission')}</div>
          </div>
          <div class="score-pill">${teacherFeedback?.score ?? aiFeedback?.score ?? '--'}</div>
        </div>
        <div class="history-card-stats">
          <div><span>Words</span><b>${submission.word_count}</b></div>
          <div><span>Time</span><b>${formatDuration(submission.time_used_seconds)}</b></div>
          <div><span>Feedback</span><b>${feedbackLabel(teacherFeedback, aiFeedback)}</b></div>
        </div>
        <p class="history-excerpt">${escapeHtml(submission.essay).slice(0, 340)}${submission.essay.length > 340 ? '...' : ''}</p>
        <div class="item-actions">
          <button type="button" onclick="openStudentSubmissionDetail('${submission.id}')">查看反馈</button>
          <button type="button" class="secondary" onclick="restartPractice('${submission.question_id}', '${submission.assignment_id || ''}')">重新练习</button>
          ${renderAiButton(submission)}
        </div>
      </article>
    `;
  }).join('');

  controls.innerHTML = `
    <button class="ghost" type="button" onclick="rotateStudentHistory('prev')">上一张</button>
    <span>${state.studentHistoryIndex + 1} / ${state.submissions.length}</span>
    <button class="ghost" type="button" onclick="rotateStudentHistory('next')">下一张</button>
  `;
}

function renderAiButton(submission) {
  const aiFeedback = state.aiFeedbacks.find((item) => item.submission_id === submission.id && item.status === 'completed');
  if (aiFeedback) return '<span class="badge">AI 已反馈</span>';
  const assignment = state.assignments.find((item) => item.id === submission.assignment_id);
  const hasCredit = state.entitlements.some((item) => item.entitlement_type === 'ai_feedback' && Number(item.remaining_uses || 0) > 0);
  const canRequest = assignment?.allow_ai_feedback && hasCredit;
  const title = !assignment?.allow_ai_feedback ? '这道题未开放 AI 反馈' : !hasCredit ? '没有可用 AI 次数' : '';
  return `<button type="button" class="secondary" onclick="requestAiFeedback('${submission.id}')" ${canRequest ? '' : 'disabled'} title="${title}">AI 反馈</button>`;
}

function feedbackLabel(teacherFeedback, aiFeedback) {
  if (teacherFeedback && aiFeedback) return '老师 + AI';
  if (teacherFeedback) return '老师';
  if (aiFeedback) return 'AI';
  return '待反馈';
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const m = Math.floor(value / 60);
  const s = value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

window.rotateStudentHistory = function rotateStudentHistory(direction) {
  if (!state.submissions.length) return;
  if (direction === 'next') state.studentHistoryIndex = (state.studentHistoryIndex + 1) % state.submissions.length;
  else state.studentHistoryIndex = (state.studentHistoryIndex - 1 + state.submissions.length) % state.submissions.length;
  renderStudentHistory();
};

window.openStudentSubmissionDetail = function openStudentSubmissionDetail(submissionId) {
  const submission = state.submissions.find((item) => item.id === submissionId);
  if (!submission) return;
  setStudentView('history');
  const teacherFeedback = state.feedbacks.find((item) => item.submission_id === submission.id);
  const aiFeedback = state.aiFeedbacks.find((item) => item.submission_id === submission.id && item.status === 'completed');
  const detail = $('studentHistoryDetail');
  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="item-title">${escapeHtml(submission.questions?.title || 'Submission')}</div>
        <div class="meta">
          <span>${submission.word_count} words</span>
          <span>${formatDate(submission.created_at)}</span>
          <span>${formatDuration(submission.time_used_seconds)}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="secondary" type="button" onclick="restartPractice('${submission.question_id}', '${submission.assignment_id || ''}')">重新练习</button>
        <button class="ghost" type="button" onclick="closeStudentSubmissionDetail()">收起</button>
      </div>
    </div>
    <div class="detail-grid">
      <section>
        <h3>原文</h3>
        <div class="essay-preview">${escapeHtml(submission.essay)}</div>
      </section>
      <section>
        <h3>反馈</h3>
        ${renderTeacherFeedbackDetail(teacherFeedback)}
        ${renderAiFeedbackDetail(aiFeedback)}
        ${!teacherFeedback && !aiFeedback ? '<div class="empty-state compact-empty">暂无反馈。</div>' : ''}
      </section>
    </div>
  `;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function renderTeacherFeedbackDetail(feedback) {
  if (!feedback) return '';
  return `
    <div class="feedback-block teacher-feedback">
      <div class="feedback-title">老师反馈 <b>${escapeHtml(feedback.score ?? '--')}</b></div>
      <p>${escapeHtml(feedback.summary || '')}</p>
    </div>
  `;
}

function renderAiFeedbackDetail(feedback) {
  if (!feedback) return '';
  const result = feedback.result_json || {};
  return `
    <div class="feedback-block ai-feedback">
      <div class="feedback-title">AI 反馈 <b>${escapeHtml(feedback.score ?? result.score ?? '--')}</b></div>
      <p>${escapeHtml(result.summary || 'AI feedback saved.')}</p>
      ${renderFeedbackList('语法问题', result.grammar_errors)}
      ${renderFeedbackList('表达问题', result.expression_errors)}
      ${result.revised_essay ? `<h4>修改后范文</h4><div class="essay-preview mini">${escapeHtml(result.revised_essay)}</div>` : ''}
    </div>
  `;
}

function renderFeedbackList(title, rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  return `
    <h4>${title}</h4>
    <ul class="feedback-list">
      ${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}

window.closeStudentSubmissionDetail = function closeStudentSubmissionDetail() {
  $('studentHistoryDetail').classList.add('hidden');
};

window.requestAiFeedback = async function requestAiFeedback(submissionId) {
  showStatus('正在请求 AI 反馈...');
  const { data, error } = await state.client.functions.invoke('ai-feedback', {
    body: { submission_id: submissionId }
  });

  if (error) {
    showStatus(`AI 反馈失败：${error.message}`, 'danger');
    return;
  }

  showStatus(data?.message || 'AI 反馈已生成。');
  await loadStudentDashboard();
};

function renderStudentInbox() {
  const box = $('studentInbox');
  if (!state.notifications.length) {
    box.innerHTML = '<div class="item">暂无消息。</div>';
    return;
  }
  box.innerHTML = state.notifications.map((item) => `
    <div class="item">
      <div class="item-title">${escapeHtml(item.title)}</div>
      <p>${escapeHtml(item.body)}</p>
      <div class="meta"><span>${formatDate(item.created_at)}</span></div>
    </div>
  `).join('');
}

function toggleMessages() {
  if (state.messageDrawerOpen) closeMessages();
  else openMessages();
}

function openMessages() {
  state.messageDrawerOpen = true;
  $('messageDrawerBackdrop').classList.remove('hidden');
  renderNav();
}

function closeMessages() {
  state.messageDrawerOpen = false;
  $('messageDrawerBackdrop').classList.add('hidden');
  if (state.profile) renderNav();
}

function renderStudentPayments() {
  const box = $('studentPaymentRequests');
  if (!state.paymentRequests.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = state.paymentRequests.map((item) => `
    <div class="item">
      <div class="item-title">${escapeHtml(item.request_type)}</div>
      <p>${escapeHtml(item.note || '')}</p>
      <div class="meta"><span>${escapeHtml(item.status)}</span><span>${formatDate(item.created_at)}</span></div>
    </div>
  `).join('');
}

window.prefillUpgradeRequest = function prefillUpgradeRequest(questionId) {
  const question = questionCatalogRows().find((item) => item.id === questionId);
  const typeLabel = question?.type === 'email' ? 'Email 写作' : question?.type === 'academic' ? 'Academic Discussion' : '题目';
  setStudentView('payments');
  $('paymentType').value = 'question_unlock';
  $('paymentNote').value = question
    ? `申请解锁题目：${questionSetLabel(question)} · ${typeLabel}`
    : '申请解锁题目';
  $('paymentNote').focus();
};

async function createPaymentRequest() {
  const requestType = $('paymentType').value;
  const note = $('paymentNote').value.trim();
  const { error } = await state.client.from('payment_requests').insert({
    user_id: state.session.user.id,
    request_type: requestType,
    note,
    status: 'pending'
  });

  if (error) {
    showStatus(error.message, 'danger');
    return;
  }
  $('paymentNote').value = '';
  showStatus('升级申请已提交。');
  await loadStudentDashboard();
}

async function loadTeacherDashboard() {
  showStatus('正在加载教师端数据...');
  $('teacherDashboard').classList.remove('hidden');
  $('studentDashboard').classList.add('hidden');

  const [studentsRes, questionsRes, assignmentsRes, submissionsRes, paymentsRes] = await Promise.all([
    state.client.from('profiles').select('*').eq('role', 'student').order('created_at', { ascending: false }),
    state.client.from('questions').select('*').eq('is_active', true).order('import_index', { ascending: true }),
    state.client.from('assignments').select('*').eq('teacher_id', state.session.user.id).order('created_at', { ascending: false }),
    state.client.from('submissions').select('*').order('created_at', { ascending: false }).limit(50),
    state.client.from('payment_requests').select('*').order('created_at', { ascending: false }).limit(50)
  ]);

  if (studentsRes.error) throw studentsRes.error;
  state.students = studentsRes.data || [];
  state.questions = questionsRes.data || [];
  state.assignments = assignmentsRes.data || [];
  state.submissions = submissionsRes.data || [];
  state.paymentRequests = paymentsRes.data || [];

  renderTeacherStats();
  renderTeacherControls();
  renderTeacherStudents();
  renderTeacherSubmissions();
  renderTeacherPayments();
  showStatus('');
}

function renderTeacherStats() {
  $('teacherStats').innerHTML = `
    <div class="stat">学生<b>${state.students.length}</b></div>
    <div class="stat">题库<b>${state.questions.length}</b></div>
    <div class="stat">作业<b>${state.assignments.length}</b></div>
    <div class="stat">提交<b>${state.submissions.length}</b></div>
  `;
}

function optionHtml(items, labelFn) {
  return items.map((item) => `<option value="${item.id}">${escapeHtml(labelFn(item))}</option>`).join('');
}

function renderTeacherControls() {
  const studentOptions = optionHtml(state.students, (item) => `${item.display_name || item.email} (${item.email || shortId(item.id)})`);
  const questionOptions = optionHtml(state.questions, (item) => `${item.import_index || ''} ${item.type} · ${item.title}`);
  $('assignStudent').innerHTML = studentOptions;
  $('grantStudent').innerHTML = studentOptions;
  $('assignQuestion').innerHTML = questionOptions;
  $('grantQuestion').innerHTML = questionOptions;
}

function renderTeacherStudents() {
  const box = $('teacherStudents');
  if (!state.students.length) {
    box.innerHTML = '<div class="item">暂无学生。</div>';
    return;
  }
  box.innerHTML = state.students.map((student) => `
    <div class="item">
      <div class="item-title">${escapeHtml(student.display_name || student.email)}</div>
      <div class="meta"><span>${escapeHtml(student.email || '')}</span><span>${formatDate(student.created_at)}</span></div>
    </div>
  `).join('');
}

function assignmentById(id) {
  return state.assignments.find((item) => item.id === id);
}

function questionById(id) {
  return state.questions.find((item) => item.id === id);
}

function studentById(id) {
  return state.students.find((item) => item.id === id);
}

function renderTeacherSubmissions() {
  const box = $('teacherSubmissions');
  if (!state.submissions.length) {
    box.innerHTML = '<div class="item">暂无提交。</div>';
    return;
  }
  box.innerHTML = state.submissions.map((submission) => {
    const student = studentById(submission.student_id);
    const question = questionById(submission.question_id);
    return `
      <div class="item">
        <div class="item-title">${escapeHtml(question?.title || 'Submission')}</div>
        <div class="meta">
          <span>${escapeHtml(student?.display_name || student?.email || shortId(submission.student_id))}</span>
          <span>${submission.word_count} words</span>
          <span>${formatDate(submission.created_at)}</span>
        </div>
        <p>${escapeHtml(submission.essay).slice(0, 260)}${submission.essay.length > 260 ? '...' : ''}</p>
        <div class="item-actions">
          <button type="button" onclick="openReview('${submission.id}')">批改</button>
        </div>
      </div>
    `;
  }).join('');
}

async function createAssignment() {
  const studentId = $('assignStudent').value;
  const questionId = $('assignQuestion').value;
  if (!studentId || !questionId) {
    showStatus('请选择学生和题目。', 'warning');
    return;
  }

  const { error } = await state.client.from('assignments').insert({
    teacher_id: state.session.user.id,
    student_id: studentId,
    question_id: questionId,
    instructions: $('assignInstructions').value.trim(),
    allow_ai_feedback: $('assignAllowAi').checked,
    status: 'published'
  });

  if (error) {
    showStatus(error.message, 'danger');
    return;
  }

  $('assignInstructions').value = '';
  $('assignAllowAi').checked = false;
  showStatus('题目已分发。');
  await loadTeacherDashboard();
}

async function grantEntitlement() {
  const userId = $('grantStudent').value;
  const kind = $('grantKind').value;
  const questionId = $('grantQuestion').value;
  const payload = {
    user_id: userId,
    entitlement_type: kind,
    question_id: kind === 'question' ? questionId : null,
    remaining_uses: kind === 'ai_feedback' ? 1 : null,
    note: $('grantNote').value.trim()
  };

  const { error } = await state.client.from('entitlements').insert(payload);
  if (error) {
    showStatus(error.message, 'danger');
    return;
  }

  await state.client.from('notifications').insert({
    user_id: userId,
    title: '权益已发放',
    body: kind === 'ai_feedback' ? '你获得了 1 次 AI 反馈。' : '你获得了一个题目解锁。'
  });

  $('grantNote').value = '';
  showStatus('权益已发放。');
}

function renderTeacherPayments() {
  const box = $('teacherPaymentRequests');
  const rows = state.paymentRequests.filter((item) => item.status === 'pending');
  if (!rows.length) {
    box.innerHTML = '<div class="item">暂无待处理申请。</div>';
    return;
  }
  box.innerHTML = rows.map((item) => {
    const student = studentById(item.user_id);
    return `
      <div class="item">
        <div class="item-title">${escapeHtml(student?.display_name || student?.email || shortId(item.user_id))}</div>
        <div class="meta"><span>${escapeHtml(item.request_type)}</span><span>${formatDate(item.created_at)}</span></div>
        <p>${escapeHtml(item.note || '')}</p>
        <div class="item-actions">
          <button type="button" class="secondary" onclick="markPayment('${item.id}', 'approved')">标记已处理</button>
          <button type="button" class="ghost" onclick="markPayment('${item.id}', 'rejected')">拒绝</button>
        </div>
      </div>
    `;
  }).join('');
}

window.markPayment = async function markPayment(id, status) {
  const { error } = await state.client
    .from('payment_requests')
    .update({ status, handled_by: state.session.user.id, handled_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showStatus(error.message, 'danger');
    return;
  }
  showStatus('付款申请状态已更新。');
  await loadTeacherDashboard();
};

window.openReview = function openReview(submissionId) {
  const submission = state.submissions.find((item) => item.id === submissionId);
  if (!submission) return;
  state.currentReviewSubmission = submission;
  $('reviewBox').classList.remove('hidden');
  $('reviewEssay').textContent = submission.essay;
  $('reviewScore').value = '';
  $('reviewSummary').value = '';
  $('reviewSummary').focus();
};

function closeReview() {
  state.currentReviewSubmission = null;
  $('reviewBox').classList.add('hidden');
}

async function publishFeedback() {
  const submission = state.currentReviewSubmission;
  if (!submission) return;
  const score = $('reviewScore').value ? Number($('reviewScore').value) : null;
  const summary = $('reviewSummary').value.trim();
  if (!summary) {
    showStatus('请填写反馈。', 'warning');
    return;
  }

  const { error } = await state.client.from('teacher_feedbacks').insert({
    submission_id: submission.id,
    teacher_id: state.session.user.id,
    score,
    summary,
    published: true
  });

  if (error) {
    showStatus(error.message, 'danger');
    return;
  }

  await state.client.from('notifications').insert({
    user_id: submission.student_id,
    title: '老师发布了反馈',
    body: summary.slice(0, 180)
  });

  closeReview();
  showStatus('反馈已发布。');
  await loadTeacherDashboard();
}

init().catch((error) => {
  console.error(error);
  showStatus(error.message || String(error), 'danger');
  showAuthNotice(error.message || String(error));
});
