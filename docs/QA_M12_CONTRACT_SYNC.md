# QA — M12 Native Conversation Fixture Contract Sync

This branch fixes regression-test drift only. It does not change AWH production behavior.

The current `HubNativeAgentService::respond()` contract is conversation-bound, so the M12 history fixture now supplies the persisted conversation and message identifiers that the fixture already creates. The durable native-conversation success fixture also uses a dedicated provider response returning `output_text`, while the separate function-calling fixture remains responsible for validating `respondWithTools()` stateless continuation.

A GitHub one-shot verification ran the complete `npm run hub:test` suite successfully through M13 before committing the fixture changes and removing its temporary workflow.
