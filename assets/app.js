const cfg = window.BETA_CONFIG || {};
const $ = (id) => document.getElementById(id);

const state = {
  client: null,
  session: null,
  profile: null,
  students: [],
  questions: [],
  assignments: [],
  submissions: [],
  feedbacks: [],
  aiFeedbacks: [],
  notifications: [],
  paymentRequests: [],
  entitlements: [],
  currentAssignment: null,
  currentReviewSubmission: null,
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
  $('loginBtn').addEventListener('click', login);
  $('registerBtn').addEventListener('click', registerStudent);
  $('logoutBtn').addEventListener('click', logout);
  $('refreshStudentBtn').addEventListener('click', loadStudentDashboard);
  $('refreshTeacherBtn').addEventListener('click', loadTeacherDashboard);
  $('saveDraftBtn').addEventListener('click', saveDraft);
  $('submitEssayBtn').addEventListener('click', submitEssay);
  $('essayInput').addEventListener('input', handleEssayInput);
  $('createPaymentRequestBtn').addEventListener('click', createPaymentRequest);
  $('createAssignmentBtn').addEventListener('click', createAssignment);
  $('grantEntitlementBtn').addEventListener('click', grantEntitlement);
  $('closeReviewBtn').addEventListener('click', closeReview);
  $('publishFeedbackBtn').addEventListener('click', publishFeedback);
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
  const label = role === 'teacher' ? '教师端' : '学生端';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'active';
  btn.textContent = label;
  nav.appendChild(btn);
}

async function login() {
  showAuthNotice('');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const { error } = await state.client.auth.signInWithPassword({ email, password });
  if (error) showAuthNotice(error.message);
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

  const [assignmentsRes, submissionsRes, feedbacksRes, aiRes, inboxRes, payRes, entRes] = await Promise.all([
    state.client.from('assignments').select('*, questions(*)').eq('student_id', userId).eq('status', 'published').order('created_at', { ascending: false }),
    state.client.from('submissions').select('*, questions(*)').eq('student_id', userId).order('created_at', { ascending: false }),
    state.client.from('teacher_feedbacks').select('*').eq('published', true).order('created_at', { ascending: false }),
    state.client.from('ai_feedbacks').select('*').eq('student_id', userId).order('created_at', { ascending: false }),
    state.client.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
    state.client.from('payment_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    state.client.from('entitlements').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  ]);

  if (assignmentsRes.error) throw assignmentsRes.error;
  state.assignments = assignmentsRes.data || [];
  state.submissions = submissionsRes.data || [];
  state.feedbacks = feedbacksRes.data || [];
  state.aiFeedbacks = aiRes.data || [];
  state.notifications = inboxRes.data || [];
  state.paymentRequests = payRes.data || [];
  state.entitlements = entRes.data || [];

  renderStudentAssignments();
  renderStudentSubmissions();
  renderStudentInbox();
  renderStudentPayments();
  showStatus('');
}

function renderStudentAssignments() {
  const box = $('studentAssignments');
  if (!state.assignments.length) {
    box.innerHTML = '<div class="item">暂无分发题目。</div>';
    return;
  }
  box.innerHTML = state.assignments.map((assignment) => {
    const q = assignment.questions;
    return `
      <div class="item">
        <div class="item-title">${escapeHtml(q?.title || 'Untitled')}</div>
        <div class="meta">
          <span class="badge">${escapeHtml(q?.type || '')}</span>
          <span>${Math.round((q?.time_limit_seconds || 0) / 60)} 分钟</span>
          <span>${formatDate(assignment.created_at)}</span>
        </div>
        <div class="item-actions">
          <button type="button" onclick="startAssignment('${assignment.id}')">开始写作</button>
        </div>
      </div>
    `;
  }).join('');
}

window.startAssignment = function startAssignment(assignmentId) {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  state.currentAssignment = assignment;
  state.writerStartedAt = Date.now();
  $('studentWriter').classList.remove('hidden');
  $('studentPrompt').innerHTML = renderPrompt(assignment.questions);
  $('essayInput').value = localStorage.getItem(draftKey(assignment.id)) || '';
  updateWriterMeta();
  clearInterval(state.writerTimer);
  state.writerTimer = setInterval(updateWriterMeta, 1000);
  $('essayInput').focus();
};

function draftKey(assignmentId) {
  return `beta_draft_${state.session.user.id}_${assignmentId}`;
}

function handleEssayInput() {
  updateWriterMeta();
  if (state.currentAssignment) {
    localStorage.setItem(draftKey(state.currentAssignment.id), $('essayInput').value);
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
  localStorage.setItem(draftKey(state.currentAssignment.id), $('essayInput').value);
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
    assignment_id: assignment.id,
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

  localStorage.removeItem(draftKey(assignment.id));
  $('essayInput').value = '';
  $('studentWriter').classList.add('hidden');
  showStatus('已提交。');
  await loadStudentDashboard();
}

function renderStudentSubmissions() {
  const box = $('studentSubmissions');
  if (!state.submissions.length) {
    box.innerHTML = '<div class="item">暂无提交。</div>';
    return;
  }

  box.innerHTML = state.submissions.map((submission) => {
    const teacherFeedback = state.feedbacks.find((item) => item.submission_id === submission.id);
    const aiFeedback = state.aiFeedbacks.find((item) => item.submission_id === submission.id && item.status === 'completed');
    const canAi = state.entitlements.some((item) => item.entitlement_type === 'ai_feedback' && Number(item.remaining_uses || 0) > 0);
    return `
      <div class="item">
        <div class="item-title">${escapeHtml(submission.questions?.title || 'Submission')}</div>
        <div class="meta">
          <span>${submission.word_count} words</span>
          <span>${formatDate(submission.created_at)}</span>
          ${teacherFeedback ? '<span class="badge">老师已反馈</span>' : ''}
          ${aiFeedback ? '<span class="badge">AI 已反馈</span>' : ''}
        </div>
        ${teacherFeedback ? `<p><b>老师评分：</b>${escapeHtml(teacherFeedback.score ?? '')}</p><p>${escapeHtml(teacherFeedback.summary || '')}</p>` : ''}
        ${aiFeedback ? `<p><b>AI 评分：</b>${escapeHtml(aiFeedback.score ?? '')}</p><p>${escapeHtml(aiFeedback.result_json?.summary || 'AI feedback saved.')}</p>` : ''}
        <div class="item-actions">
          <button type="button" class="secondary" onclick="requestAiFeedback('${submission.id}')" ${canAi ? '' : 'disabled'}>AI 反馈</button>
        </div>
      </div>
    `;
  }).join('');
}

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
  showStatus('付款申请已提交。');
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

