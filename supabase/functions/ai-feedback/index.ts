import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

type FeedbackResult = {
  score?: number;
  summary?: string;
  grammar_errors?: string[];
  expression_errors?: string[];
  revised_essay?: string;
};

function getSupabaseKey(name: 'publishable' | 'secret') {
  const legacyName = name === 'publishable' ? 'SUPABASE_ANON_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
  const legacyValue = Deno.env.get(legacyName);
  if (legacyValue) return legacyValue;

  const dictionaryName = name === 'publishable' ? 'SUPABASE_PUBLISHABLE_KEYS' : 'SUPABASE_SECRET_KEYS';
  const dictionaryValue = Deno.env.get(dictionaryName);
  if (!dictionaryValue) return '';

  const parsed = JSON.parse(dictionaryValue) as Record<string, string>;
  return parsed.default || Object.values(parsed)[0] || '';
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = getSupabaseKey('publishable');
    const serviceKey = getSupabaseKey('secret');
    const deepseekKey = Deno.env.get('DEEPSEEK_API_KEY')!;
    const model = Deno.env.get('DEEPSEEK_MODEL') || 'deepseek-chat';
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Missing Supabase function secrets.');
    if (!deepseekKey) throw new Error('Missing DEEPSEEK_API_KEY.');
    if (!authHeader) throw new Error('Missing Authorization header.');

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error('Invalid user session.');

    const { submission_id } = await req.json();
    if (!submission_id) throw new Error('Missing submission_id.');

    const { data: submission, error: submissionError } = await admin
      .from('submissions')
      .select('*, questions(*), assignments(*)')
      .eq('id', submission_id)
      .single();

    if (submissionError || !submission) throw new Error('Submission not found.');
    if (submission.student_id !== userData.user.id) throw new Error('You can only request feedback for your own submission.');
    if (!submission.assignments?.allow_ai_feedback) throw new Error('AI feedback is not enabled for this assignment.');

    const { data: entitlement, error: entitlementError } = await admin
      .from('entitlements')
      .select('*')
      .eq('user_id', userData.user.id)
      .eq('entitlement_type', 'ai_feedback')
      .gt('remaining_uses', 0)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (entitlementError) throw entitlementError;
    if (!entitlement) throw new Error('No AI feedback credits available.');

    const question = submission.questions;
    const payload = question.prompt_payload || {};
    const promptText = question.type === 'academic'
      ? payload.professor?.text || ''
      : payload.context || '';

    const systemPrompt = 'You are an expert TOEFL iBT Writing rater. Return strict JSON only.';
    const userPrompt = `
Task Type: ${question.type}
Prompt: ${promptText}
Student Essay: ${submission.essay}

Return JSON:
{
  "score": number from 0 to 6,
  "summary": "concise feedback in Chinese",
  "grammar_errors": ["issue -> correction"],
  "expression_errors": ["issue -> better expression"],
  "revised_essay": "full improved essay"
}
`;

    const aiResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deepseekKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const aiJson = await aiResponse.json();
    if (!aiResponse.ok) {
      throw new Error(aiJson?.error?.message || 'AI provider error.');
    }

    const content = aiJson.choices?.[0]?.message?.content || '{}';
    const result = JSON.parse(content) as FeedbackResult;

    const { error: feedbackInsertError } = await admin.from('ai_feedbacks').insert({
      submission_id,
      student_id: userData.user.id,
      requested_by: userData.user.id,
      provider: 'deepseek',
      model,
      status: 'completed',
      score: result.score ?? null,
      result_json: result
    });

    if (feedbackInsertError) throw feedbackInsertError;

    const { error: entitlementUpdateError } = await admin
      .from('entitlements')
      .update({ remaining_uses: Math.max(0, Number(entitlement.remaining_uses || 1) - 1) })
      .eq('id', entitlement.id);

    if (entitlementUpdateError) throw entitlementUpdateError;

    await admin.from('notifications').insert({
      user_id: userData.user.id,
      title: 'AI 反馈已生成',
      body: result.summary || '你的 AI 反馈已生成。'
    });

    return jsonResponse({ message: 'AI feedback completed.', result });
  } catch (error) {
    return jsonResponse({ error: error.message || String(error) }, 400);
  }
});
