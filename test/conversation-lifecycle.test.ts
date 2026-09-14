import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('conversation lifecycle is reversible and preserves canonical task/artifact authority', async () => {
  const [migration, service, router, adapter, html, app, styles, lightCss, dashboard, dashboardCss] = await Promise.all([
    readFile(new URL('../hub/migrations/018_conversation_lifecycle.sql', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8'),
    readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../web/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/awh-light-system.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/dashboard.css', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /ALTER TABLE control_conversations ADD COLUMN deleted_at TEXT/);
  assert.match(migration, /deleted_by_user_id/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*conversation/i);
  assert.doesNotMatch(service, /DELETE FROM control_conversations/i);
  assert.match(service, /CONVERSATION_ACTIVE_TASKS/);
  assert.match(service, /UPDATE control_project_contexts SET conversation_id=NULL/);
  assert.match(router, /conversations\/trash/);
  assert.match(router, /conversations\/thread\/.*\/lifecycle/);
  assert.match(adapter, /updateConversationLifecycle/);
  assert.match(html, /id="conversation-delete"/);
  assert.match(html, /id="conversation-trash-list"/);
  assert.match(app, /กู้คืน/);
  assert.match(app, /window\.confirm/);
  assert.match(app, /data\.scrollKey|dataset\.scrollKey/);
  assert.match(app, /threadFollowLatest/);
  assert.match(html, /id="conversation-latest"/);
  assert.match(html, /id="work-thread"[^>]*role="log"[^>]*aria-live="off"/);
  assert.match(html, /id="work-announcer"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /function announceNewAssistantTurn/);
  assert.match(app, /messages\.slice\(previousCount\)/);
  assert.match(app, /body\.length > 180/);
  assert.match(styles, /safe-area-inset-top/);
  assert.match(dashboard, /visualViewport/);
  assert.match(dashboard, /keyboardViewportBaseline/);
  assert.match(dashboard, /lostHeight > 96/);
  assert.match(dashboard, /focusin/);
  assert.doesNotMatch(styles, /:has\(#goal-input:focus\)/);
  assert.match(styles, /awh-keyboard-open[^}]*\.composer textarea[^}]*min-height:\s*40px/s);
  assert.match(dashboardCss, /repeat\(4,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(styles, /body\.work-active:not\(\.product-dashboard-active\) \.awh-mobile-nav \{ display: none; \}/);
  assert.match(service, /BROWSER_CONVERSATION_MAX_BYTES\s*=\s*192\s*\*\s*1024/);
  assert.match(service, /CONVERSATION_MESSAGE_LIMIT\s*=\s*120/);
  assert.match(service, /ORDER BY sequence_no DESC LIMIT/);
  assert.match(service, /array_reverse\(\$messageQuery->fetchAll\(\)\)/);
  assert.match(service, /\$maxBodyBytes = \$kind === 'USER' \? self::GOAL_MAX_BYTES : 800/);
  assert.match(html, /id="goal-input"[^>]*maxlength="5000"/);
  assert.match(adapter, /message\.length > 5000/);
  assert.match(app, /conversation-history-note/);
  assert.match(app, /state\.conversationAvailable = Boolean\(state\.selectedConversationId\)/);
  assert.match(app, /ลองโหลดใหม่/);
  assert.match(styles, /\.composer-count/);
  assert.match(lightCss, /\.empty-work\{min-height:0!important/);
});

test('long conversation projection keeps the newest messages and remains browser bounded', () => {
  const php = String.raw`
require 'hub/src/HubControlPlaneService.php';
$method = new ReflectionMethod(HubControlPlaneService::class, 'boundConversationPayload');
$method->setAccessible(true);
$messages=[]; for($i=1;$i<=240;$i++) $messages[]=['messageId'=>(string)$i,'taskId'=>null,'kind'=>'user','sequence'=>$i,'body'=>str_repeat('m',1400),'createdAt'=>'2026-09-14T00:00:00Z'];
$tasks=[]; for($i=1;$i<=80;$i++) $tasks[]=['taskId'=>(string)$i,'goal'=>str_repeat('g',1800)];
$payload=['schemaVersion'=>3,'conversation'=>['conversationId'=>'c'],'history'=>['truncated'=>false,'messageCount'=>240,'visibleMessageCount'=>240,'taskCount'=>80,'visibleTaskCount'=>80],'messages'=>$messages,'tasks'=>$tasks,'artifacts'=>[],'attachments'=>[],'approvals'=>[]];
$out=$method->invoke(null,$payload,192*1024);
echo json_encode(['bytes'=>strlen(json_encode($out,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)),'first'=>$out['messages'][0]['sequence']??null,'last'=>$out['messages'][count($out['messages'])-1]['sequence']??null,'history'=>$out['history']],JSON_THROW_ON_ERROR);
`;
  const result=JSON.parse(execFileSync('php',['-r',php],{cwd:process.cwd(),encoding:'utf8'}));
  assert.ok(result.bytes <= 192*1024);
  assert.equal(result.last,240);
  assert.ok(result.first > 1);
  assert.equal(result.history.truncated,true);
  assert.equal(result.history.visibleMessageCount,240-result.first+1);
});
