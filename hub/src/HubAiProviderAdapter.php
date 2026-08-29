<?php

declare(strict_types=1);

final class HubAiProviderAdapterException extends RuntimeException
{
    /** @param array<string,mixed> $diagnostic */
    public function __construct(string $message, public readonly string $codeName = 'PROVIDER_UNAVAILABLE', public readonly array $diagnostic = []) { parent::__construct($message); }
}

interface HubAiProviderAdapter
{
    public function providerId(): string;
    /** @param array<string,mixed> $payload @return array<string,mixed> */
    public function call(array $payload, string $credential): array;
}
