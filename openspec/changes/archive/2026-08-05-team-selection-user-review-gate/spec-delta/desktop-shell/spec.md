## ADDED Requirements

### Requirement: Product development official team separates specification and user-task review
Source: docs/product/pages/agent-teams.md#产品研发闭环团队的用户评审闸门

The packaged `product-development` official team MUST contain distinct `product-reviewer` and `user-reviewer` members. Product review MUST assess PRD completeness before UI work. User-task review MUST independently attempt a supplied target-user task before implementation against the approved production Page Story or prototype, and after technical QA against the real product entry. Its brief MUST omit implementation rationale and prescribed interaction steps.

Failed user-task review MUST return observable blocking evidence to the primary Agent for product, design or implementation classification. Functional and visual QA MUST NOT substitute for user-task review, and user-task review MUST NOT substitute for technical QA.

#### Scenario: Technical QA success still receives real-product user review

- GIVEN implementation has passed functional and visual QA
- WHEN the product-development primary Agent prepares delivery
- THEN it delegates the target-user task to `user-reviewer` from the real product entry
- AND delivery does not close until that review completes or returns blocking evidence.
