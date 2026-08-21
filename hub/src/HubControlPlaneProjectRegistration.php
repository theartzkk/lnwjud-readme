<?php

declare(strict_types=1);

final class HubControlPlaneProjectRegistrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROJECT_REGISTRATION_FAILED') { parent::__construct($message); }
}

/** Registers only portable project metadata; source and Project Memory stay canonical in project workspaces. */
final class HubControlPlaneProjectRegistration
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    public const PORTABLE_PROJECTS = [
        ['projectId' => 'd1e48976-cfde-479d-9a9c-f3b0ab5ec4fc', 'name' => 'BAY EXCUSE X', 'type' => 'php'],
        ['projectId' => 'dad35312-06d6-488b-9ed2-f4886d5394ac', 'name' => 'Teacher Evaluation Video', 'type' => 'remotion'],
    ];

    /** @param list<array{projectId:string,name:string,type:string}> $projects */
    public static function register(PDO $pdo, array $projects = self::PORTABLE_PROJECTS, ?string $now = null): int
    {
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() !== 4) throw new HubControlPlaneProjectRegistrationException('M4 schema is not active', 'CONTROL_SCHEMA_NOT_READY');
        $owner = $pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1')->fetchColumn();
        if (!is_string($owner) || !preg_match(self::UUID, $owner)) throw new HubControlPlaneProjectRegistrationException('Closed owner identity is unavailable', 'OWNER_NOT_READY');
        $now ??= gmdate('c');
        try {
            $pdo->beginTransaction();
            foreach ($projects as $project) {
                if (!is_array($project) || !is_string($project['projectId'] ?? null) || !preg_match(self::UUID, $project['projectId']) || !is_string($project['name'] ?? null) || trim($project['name']) === '' || strlen($project['name']) > 120 || !is_string($project['type'] ?? null) || !preg_match('/^[a-z][a-z0-9-]{0,31}$/', $project['type'])) throw new HubControlPlaneProjectRegistrationException('Portable project metadata is invalid', 'PROJECT_METADATA_INVALID');
                $query = $pdo->prepare('SELECT name, type FROM projects WHERE project_id = :id');
                $query->execute(['id' => strtolower($project['projectId'])]);
                $existing = $query->fetch();
                if (is_array($existing) && ((string) $existing['name'] !== trim($project['name']) || (string) $existing['type'] !== strtolower($project['type']))) throw new HubControlPlaneProjectRegistrationException('Existing project metadata conflicts with the portable identity', 'PROJECT_METADATA_CONFLICT');
                if (!is_array($existing)) {
                    $insert = $pdo->prepare('INSERT INTO projects(project_id, name, type, created_at, source_revision, observed_at, provenance) VALUES(:id, :name, :type, :created, NULL, :observed, :provenance)');
                    $insert->execute(['id' => strtolower($project['projectId']), 'name' => trim($project['name']), 'type' => strtolower($project['type']), 'created' => $now, 'observed' => $now, 'provenance' => 'm4-portable-project-registration']);
                }
                $membership = $pdo->prepare("INSERT INTO user_project_memberships(user_id, project_id, role, created_at, revoked_at) VALUES(:user, :project, 'owner', :at, NULL) ON CONFLICT(user_id, project_id) DO UPDATE SET revoked_at = NULL");
                $membership->execute(['user' => $owner, 'project' => strtolower($project['projectId']), 'at' => $now]);
            }
            $pdo->commit();
        } catch (HubControlPlaneProjectRegistrationException $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        } catch (Throwable) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw new HubControlPlaneProjectRegistrationException('Project registration failed closed', 'PROJECT_REGISTRATION_FAILED');
        }
        return count($projects);
    }
}
