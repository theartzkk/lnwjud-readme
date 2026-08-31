<?php

declare(strict_types=1);

/**
 * Read-only conversation referent projection.
 * It derives "latest/previous/this file" context from canonical conversation,
 * task, artifact and attachment authorities without persisting a second memory.
 */
final class HubConversationReferentService
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';

    public function __construct(private readonly PDO $pdo) {}

    /** @return array<string,mixed> */
    public function project(string $userId, string $projectId, string $conversationId): array
    {
        foreach ([$userId, $projectId, $conversationId] as $id) {
            if (preg_match(self::UUID, $id) !== 1) return self::emptyProjection();
        }
        $conversation = $this->pdo->prepare('SELECT last_task_id FROM control_conversations WHERE conversation_id=:conversation AND user_id=:user AND project_id=:project');
        $conversation->execute(['conversation'=>$conversationId,'user'=>$userId,'project'=>$projectId]);
        $row = $conversation->fetch();
        if (!is_array($row)) return self::emptyProjection();
        $lastTask = null;
        $lastTaskId = is_string($row['last_task_id'] ?? null) ? (string)$row['last_task_id'] : null;
        if ($lastTaskId !== null && preg_match(self::UUID, $lastTaskId) === 1) {
            $task = $this->pdo->prepare('SELECT task_id,goal,state,result_summary,updated_at FROM control_tasks WHERE task_id=:task AND user_id=:user AND project_id=:project AND conversation_id=:conversation');
            $task->execute(['task'=>$lastTaskId,'user'=>$userId,'project'=>$projectId,'conversation'=>$conversationId]);
            $taskRow = $task->fetch();
            if (is_array($taskRow)) $lastTask = self::task($taskRow);
        }

        $artifacts = $this->pdo->prepare('SELECT a.artifact_id,a.task_id,a.kind,a.name,a.created_at FROM control_artifacts a JOIN control_tasks t ON t.task_id=a.task_id WHERE t.user_id=:user AND t.project_id=:project AND t.conversation_id=:conversation ORDER BY a.created_at DESC,a.artifact_id DESC LIMIT 5');
        $artifacts->execute(['user'=>$userId,'project'=>$projectId,'conversation'=>$conversationId]);
        $recentArtifacts = array_map([self::class, 'artifact'], $artifacts->fetchAll());

        $recentAttachments = [];
        if ($this->tableExists('control_conversation_attachments')) {
            $attachments = $this->pdo->prepare('SELECT a.attachment_id,a.display_name,a.mime_type,a.size_bytes,a.created_at FROM control_conversation_attachments a JOIN control_conversations c ON c.conversation_id=a.conversation_id WHERE a.conversation_id=:conversation AND c.user_id=:user AND c.project_id=:project AND a.deleted_at IS NULL ORDER BY a.created_at DESC,a.attachment_id DESC LIMIT 5');
            $attachments->execute(['conversation'=>$conversationId,'user'=>$userId,'project'=>$projectId]);
            $recentAttachments = array_map([self::class, 'attachment'], $attachments->fetchAll());
        }

        return [
            'schemaVersion'=>1,
            'authority'=>'CONVERSATION_REFERENT_PROJECTION',
            'latestTask'=>$lastTask,
            'latestArtifact'=>$recentArtifacts[0] ?? null,
            'latestAttachment'=>$recentAttachments[0] ?? null,
            'recentArtifacts'=>$recentArtifacts,
            'recentAttachments'=>$recentAttachments,
        ];
    }

    private function tableExists(string $table): bool
    {
        $q = $this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");
        $q->execute(['name'=>$table]);
        return $q->fetchColumn() === 1;
    }

    private static function emptyProjection(): array
    {
        return ['schemaVersion'=>1,'authority'=>'CONVERSATION_REFERENT_PROJECTION','latestTask'=>null,'latestArtifact'=>null,'latestAttachment'=>null,'recentArtifacts'=>[],'recentAttachments'=>[]];
    }
    private static function task(array $row): array
    {
        return ['taskId'=>(string)$row['task_id'],'goal'=>self::safeText($row['goal'] ?? null,2000),
            'state'=>(string)$row['state'],'resultSummary'=>self::safeText($row['result_summary'] ?? null,1200),
            'updatedAt'=>(string)$row['updated_at']];
    }

    private static function artifact(array $row): array
    {
        return ['artifactId'=>(string)$row['artifact_id'],'taskId'=>(string)$row['task_id'],
            'kind'=>(string)$row['kind'],'name'=>self::safeText($row['name'] ?? null,240),
            'createdAt'=>(string)$row['created_at']];
    }

    private static function attachment(array $row): array
    {
        return ['attachmentId'=>(string)$row['attachment_id'],'name'=>self::safeText($row['display_name'] ?? null,240),
            'mimeType'=>(string)($row['mime_type'] ?? ''),'sizeBytes'=>(int)($row['size_bytes'] ?? 0),
            'createdAt'=>(string)$row['created_at']];
    }

    private static function safeText(mixed $value, int $max): ?string
    {
        if (!is_string($value)) return null;
        $text = trim($value);
        if ($text === '' || strlen($text) > $max || preg_match('/[\x00-\x1f\x7f]/', $text) === 1) return null;
        if (preg_match('/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]/i', $text) === 1) return null;
        return $text;
    }
}
