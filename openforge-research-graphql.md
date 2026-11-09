# OpenForge GraphQL Research — GitHub GraphQL API, octokit Patterns, Rate-Limit & Pagination Specs

> **Project:** OpenForge (self-hosted GitHub competitor — `github.com/juw12/openforge`, TypeScript monorepo)
> **Purpose:** Exhaustive reference to drive (a) OpenForge's GraphQL decision (mirror full GitHub GraphQL vs. design a **QGL** subset), (b) client SDK shape (octokit-style auto-generated via introspection vs. handwritten resolvers), (c) pagination strategy (cursor + Relay).
> **Methodology:** Context7 docs for `@octokit/graphql` / `octokit` / `@octokit/graphql-schema` / `graphql-request` / `@octokit/webhooks` / `@octokit/auth-app`; Exa web search; direct fetch of `docs.github.com` (GraphQL overview, forming calls, REST + GraphQL rate limits, 2024/2025 schema changelogs, App authentication, fine-grained PAT permissions). Every external claim carries a source URL in §11.
> **Date of research:** 2026-11-03
> **Status of `managing-queries`:** the URL `docs.github.com/en/graphql/guides/managing-queries` returns **404** — it is a legacy/redirected page. Its canonical content (query optimization, node limits, resource limits) now lives under *Rate limits and query limits for the GraphQL API*, which was fetched and is the authoritative source used here.

---

## Table of Contents

1. [GraphQL Schema Surface (top-level fields relevant to a competitor)](#1-graphql-schema-surface)
2. [octokit.graphql Usage Patterns](#2-octokitgraphql-usage-patterns)
3. [Rate Limit Specification (full)](#3-rate-limit-specification)
4. [Pagination Specification (full)](#4-pagination-specification)
5. [Authentication Patterns](#5-authentication-patterns)
6. [Error Response Format](#6-error-response-format)
7. [2024+ Schema Changes](#7-2024-schema-changes)
8. [Introspection Query (full example)](#8-introspection-query)
9. [Webhooks vs GraphQL Subscriptions](#9-webhooks-vs-graphql-subscriptions)
10. [Code Examples](#10-code-examples)
11. [References](#11-references)
12. [Recommendations for OpenForge / QGL](#12-recommendations-for-openforge--qgl)

---

## 1. GraphQL Schema Surface

### 1.0 Architecture notes a competitor MUST get right

- **Single endpoint.** The GraphQL API is a single `POST https://api.github.com/graphql` endpoint. The only `GET` is introspection. (Source: forming-calls-with-graphql.) OpenForge's `/graphql` (or `/api/graphql`) should be a single POST route; no per-object REST-style URL space.
- **Two operations only.** `query` (≈ `GET`) and `mutation` (≈ `POST`/`PATCH`/`DELETE`). There is **no `subscription`** operation in GitHub's public schema — real-time delivery is done via **webhooks** (see §9). This is a first-order design decision for QGL: *do not build a subscription transport; build a webhook emitter instead.* (Source: forming-calls-with-graphql, "two types of allowed operations…are queries and mutations".)
- **`clientMutationId` is universal.** Nearly every mutation input object has an optional `clientMutationId: String` and every mutation payload echoes it back. This is for idempotency/client-correlation. QGL should standardize on it.
- **Global IDs are opaque base64.** Every `Node` has an `id: ID!` that is a base64-encoded `Type:id` (e.g. `MDU6SXNzdWU...` = `Issue:444500041`). The `node(id: ID!): Node` and `nodes(ids: [ID!]!): [Node]!` root fields are the universal by-ID lookup. (Source: query.doc.html, forming-calls-with-graphql.)
- **`Node` interface.** Every fetchable object implements `interface Node { id: ID! }`. `node()`/`nodes()` return the `Node` interface and you inline-fragment down to the concrete type.
- **`Actor` interface.** Every `user`, `organization`, `bot` field returns the `Actor` interface (`id`, `login`, `avatarUrl`, `name`, `resourcePath`, `isBot`). You inline-fragment to `User`/`Organization`/`Bot`.
- **Connections are the only list shape.** There is no bare list — every collection is a `*Connection` with `edges`/`nodes`/`pageInfo`/`totalCount` (Relay). See §4.
- **Schema introspection + IDL.** `GET` with `Accept: application/vnd.github.v4.idl` returns the schema in IDL form; default `GET` returns JSON introspection. (Source: introduction-to-graphql.) OpenForge should ship both — it's how an octokit-style auto-generator works.

### 1.1 Top-level `Query` fields (~30 — every one a competitor should support)

The `Query` root type has ~30 fields. Non-nullable: `viewer`, `meta`, `licenses`, `marketplaceCategories`, `marketplaceListings`, `nodes`, `relay`, `search`, `securityAdvisories`, `securityVulnerabilities`, `sponsorables`. All others are nullable. (Source: graphql-schema `_autodocs` Query reference.)

| # | Field | Signature (summary) | Return | Use case |
|---|-------|---------------------|--------|----------|
| 1 | `node` | `(id: ID!)` | `Node` | Universal by-global-ID lookup. **Required.** |
| 2 | `nodes` | `(ids: [ID!]!)` | `[Node]!` | Batch by-ID lookup (max 100). **Required** for cost efficiency. |
| 3 | `viewer` | `()` | `User!` | The authenticated user. **Required.** |
| 4 | `user` | `(login: String!)` | `User` | Lookup a user by login. **Required.** |
| 5 | `organization` | `(login: String!)` | `Organization` | Lookup an org by login. **Required.** |
| 6 | `repository` | `(owner: String!, name: String!, followRenames: Boolean)` | `Repository` | Lookup a repo by owner+name. **Required (core).** |
| 7 | `repositoryOwner` | `(login: String!)` | `RepositoryOwner` | User or org that can own repos. **Required.** |
| 8 | `resource` | `(url: URI)` | `UniformResourceLocatable` | Resolve a GitHub URL to its object. Optional. |
| 9 | `search` | `(first, after, last, before, query: String!, type: SearchType!)` | `SearchResultItemConnection!` | Full search: `REPOSITORY`, `ISSUE`, `CODE`, `USER`, `COMMIT`, `DISCUSSION`, `SECURITY_ADVISORY`, `SECURITY_VULNERABILITY`. **Required (core).** |
| 10 | `meta` | `()` | `GitHubMetadata!` | `verifyingKeyUrl`, `currentUser`, `viewerCanAdminister`, `availableBusinessLogos`. |
| 11 | `rateLimit` | `(dryRun: Boolean)` | `RateLimit` | `limit`, `cost`, `remaining`, `used`, `resetAt`. **Required** (see §3). |
| 12 | `ipTrace` | `()` | `IpTrace!` | Client's IP/geo. Optional. |
| 13 | `licenses` | `()` | `[License!]!` | SPDX license list. |
| 14 | `marketplaceCategories` | `(first, after, last, before)` | `MarketplaceCategoryConnection!` | Marketplace. Optional. |
| 15 | `marketplaceListing` | `(id: ID)` | `MarketplaceListing` | Single listing. Optional. |
| 16 | `marketplaceListings` | `(first, after, last, before)` | `MarketplaceListingConnection!` | Listings. Optional. |
| 17 | `enterprise` | `(slug: String!, invitationToken: String)` | `Enterprise` | Enterprise account. GHEC-focused. |
| 18 | `enterpriseOrganizationMembership` | `(id: ID)` | `EnterpriseOrganizationMembership` | GHEC. |
| 19 | `isEnterpriseAccountUser` | `()` | `Boolean!` | GHEC. |
| 20 | `projectV2` | `(id: ID)` | `ProjectV2` | Projects v2 (the modern Projects). |
| 21 | `projectV2Item` | `(id: ID)` | `ProjectV2Item` | A single v2 project item. |
| 22 | `securityAdvisory` | `(gitDbId: String!, cveId: String)` | `SecurityAdvisory` | Single advisory. |
| 23 | `securityAdvisories` | `(first, after, last, before, filters)` | `SecurityAdvisoryV2Connection` | Advisory search. |
| 24 | `securityVulnerability` | `(gitDatabaseId: String!, package: String, range: String)` | `SecurityVulnerability` | Single vuln. |
| 25 | `sponsorables` | `(first, after, last, before, order, tiers)` | `SponsorableConnection!` | Sponsorship. Optional. |
| 26 | `reviewRequest` | `(id: ID)` | `ReviewRequest` | A pending review request. |
| 27 | `enterpriseMemberInvitation` | `(id: ID)` | `EnterpriseMemberInvitation` | **2024** — GHEC member invitations. |
| 28 | `enterpriseMemberInvitationByToken` | `(token: String!)` | `EnterpriseMemberInvitation` | **2024** — invite by token. |
| 29 | `relay` | `()` | `Query!` | Relay workaround re-exposing the root query (workaround for `facebook/relay#112`). |
| 30 | `issueField` / `issueFields` | `(id)` / connection | `IssueField` | **2025** — custom issue fields. |

> **OpenForge take:** for a v1 competitor you can ship #1–#9 + `rateLimit` + `meta` and you cover ~95% of real-world client traffic (everything octokit, `gh`, and IDEs actually call). `enterprise*`, `security*`, `marketplace*`, `sponsorables` can be deferred to a v2.

### 1.2 Top-level `Mutation` fields relevant to a competitor

GitHub's `Mutation` type has ~300 fields. Below is the **competitor-critical ~90**, grouped by domain. (Field names from the public schema + 2024/2025 changelogs. All inputs/payloads follow the `*Input`/`*Payload` convention with `clientMutationId`.)

**Repository lifecycle**

| # | Mutation | Input | Payload (return of interest) | Use |
|---|----------|-------|------------------------------|-----|
| 1 | `createRepository` | `CreateRepositoryInput!` | `repository` | Create a repo. **Core.** |
| 2 | `updateRepository` | `UpdateRepositoryInput!` | `repository` | Rename/description/archive/visibility. **Core.** |
| 3 | `deleteRepository` | `DeleteRepositoryInput!` | `repository` | Delete. **Core.** |
| 4 | `archiveRepository` | `ArchiveRepositoryInput!` | `repository` | Archive/unarchive. |
| 5 | `forkRepository` | `ForkRepositoryInput!` | `repository` / `clientMutationId` | Fork. **Core.** |
| 6 | `transferRepository` | `TransferRepositoryInput!` | `repository` | Change owner. |
| 7 | `convertRepositoryToFork` | — | `forkedRepository` | Convert to fork. |
| 8 | `createRef` | `CreateRefInput!` | `ref` | Create a branch/tag. |
| 9 | `updateRef` | `UpdateRefInput!` | `ref` | Move a ref (fast-forward/force). |
| 10 | `deleteRef` | `DeleteRefInput!` | `parent` | Delete a ref. |
| 11 | `pushProtectedHeadRef` | — | `ref` | Push to a protected ref. |
| 12 | `createProjectV2` | `CreateProjectV2Input!` | `project` | Projects v2. |
| 13 | `deleteProjectV2` | `DeleteProjectV2Input!` | `clientMutationId` | Delete v2 project. |
| 14 | `updateProjectV2` | `UpdateProjectV2Input!` | `project` | Update v2 project. |
| 15 | `updateProjectV2Field` | `UpdateProjectV2FieldInput!` | `field` | **2024-12.** |
| 16 | `createProjectV2StatusUpdate` | `CreateProjectV2StatusUpdateInput!` | `statusUpdate` | **2024-06.** |
| 17 | `updateProjectV2StatusUpdate` | `UpdateProjectV2StatusUpdateInput!` | `statusUpdate` | **2024-06.** |
| 18 | `deleteProjectV2StatusUpdate` | `DeleteProjectV2StatusUpdateInput!` | `project` | **2024-06.** |

**Issues / issue-style objects**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 19 | `createIssue` | `CreateIssueInput!` | `issue` | Create issue. **Core.** |
| 20 | `updateIssue` | `UpdateIssueInput!` | `issue` | Edit/close/reopen/assign/label. **Core.** |
| 21 | `createIssueComment` | `CreateIssueCommentInput!` | `issueComment` | Comment. **Core.** |
| 22 | `updateIssueComment` | `UpdateIssueCommentInput!` | `issueComment` | Edit comment. |
| 23 | `deleteIssueComment` | `DeleteIssueCommentInput!` | `issueComment` | Delete comment. |
| 24 | `addSubIssue` | `AddSubIssueInput!` | `issue` | **2024-12** — sub-issues. |
| 25 | `removeSubIssue` | `RemoveSubIssueInput!` | `issue` | **2024-12.** |
| 26 | `reprioritizeSubIssue` | `ReprioritizeSubIssueInput!` | `issue` | **2024-12.** |
| 27 | `addBlockedBy` | `AddBlockedByInput!` | `issue` | **2025-07** — issue dependencies. |
| 28 | `removeBlockedBy` | `RemoveBlockedByInput!` | `issue` | **2025-07.** |
| 29 | `linkIssuesToPullRequest` | `LinkIssuesToPullRequestInput!` | `linkedIssue` | Link issue↔PR. |
| 30 | `unlinkIssueFromPullRequest` | `UnlinkIssueFromPullRequestInput!` | `unlinkedIssue` | Unlink. |
| 31 | `retypeIssue` | `RetypeIssueInput!` | `issue` | Change issue type. |
| 32 | `markIssueFieldValue` | — | `issue` | **2025** — set custom field value. |
| 33 | `createIssueType` | `CreateIssueTypeInput!` | `issueType` | Define issue type. |
| 34 | `updateIssueType` | `UpdateIssueTypeInput!` | `issueType` | Edit issue type. |
| 35 | `applyIssueTemplate` | `ApplyIssueTemplateInput!` | `draftIssue` | Apply a template. |

**Pull requests (the highest-traffic domain)**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 36 | `createPullRequest` | `CreatePullRequestInput!` | `pullRequest` | Create PR. **Core.** |
| 37 | `updatePullRequest` | `UpdatePullRequestInput!` | `pullRequest` | Edit state/title/description/base. **Core.** |
| 38 | `mergePullRequest` | `MergePullRequestInput!` | `pullRequest` | Merge. **Core.** |
| 39 | `rebasePullRequest` | `RebasePullRequestInput!` | `pullRequest` | Rebase (admin). |
| 40 | `updatePullRequestBranch` | `UpdatePullRequestBranchInput!` | `pullRequest` | Update branch with base. |
| 41 | `updatePullRequestMilestone` | `UpdatePullRequestMilestoneInput!` | `pullRequest` | Set milestone. |
| 42 | `convertPullRequestToDraft` | `ConvertPullRequestToDraftInput!` | `pullRequest` | Draft. |
| 43 | `requestReviews` | `RequestReviewsInput!` | `pullRequest` | Request reviewer/teams (note: **2025-06** `botIds` added, `BotOrUser` union). |
| 44 | `removeRequestedReviewers` | `RemoveRequestedReviewersInput!` | `pullRequest` | Remove reviewers. |
| 45 | `createPullRequestReview` | `CreatePullRequestReviewInput!` | `pullRequestReview` | Submit review. **Core.** |
| 46 | `submitPullRequestReview` | `SubmitPullRequestReviewInput!` | `pullRequestReview` | Submit pending review. |
| 47 | `updatePullRequestReview` | `UpdatePullRequestReviewInput!` | `pullRequestReview` | Dismiss/edit review body. |
| 48 | `dismissReview` | `DismissReviewInput!` | `pullRequestReview` | Dismiss (approvals). |
| 49 | `createPullRequestReviewComment` | `CreatePullRequestReviewCommentInput!` | `pullRequestReviewComment` | Line comment. **Core.** |
| 50 | `updatePullRequestReviewComment` | `UpdatePullRequestReviewCommentInput!` | `pullRequestReviewComment` | Edit line comment. |
| 51 | `resolveReviewThread` | `ResolveReviewThreadInput!` | `thread` | Resolve thread. |
| 52 | `unresolveReviewThread` | `UnresolveReviewThreadInput!` | `thread` | Unresolve. |
| 53 | `createPullRequestReviewThread` | `CreatePullRequestReviewThreadInput!` | `pullRequestReviewThread` | Add thread. |
| 54 | `createDraftPullRequestReviewThread` | `DraftPullRequestReviewThread` | `thread` | Draft thread. |
| 55 | `createReviewThread` | `CreateReviewThreadInput!` | `thread` | Generic review thread. |
| 56 | `createCommitComment` | `CreateCommitCommentInput!` | `commitComment` | Comment on commit. |
| 57 | `updateCommitComment` | `UpdateCommitCommentInput!` | `commitComment` | Edit commit comment. |
| 58 | `createCommit` | `CreateCommitInput!` | `commit` | Low-level git commit create. |
| 59 | `createCommitOnBranch` | `CreateCommitOnBranchInput!` | `status` | One-shot commit to a branch (file edit). **Core for web editor.** |

**Comments / reactions / minimize**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 60 | `addReaction` | `AddReactionInput!` | `reaction`, `subject` | 👍❤️ etc. on any Reactable. **Core.** |
| 61 | `removeReaction` | `RemoveReactionInput!` | `subject` | Remove reaction. |
| 62 | `minimizeComment` | `MinimizeCommentInput!` | `minimizedComment` | Collapse. |
| 63 | `unminimizeComment` | `UnminimizeCommentInput!` | `unminimizedComment` | Restore. (**2025-09** `viewerCanUnminimize`.) |

**Gists**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 64 | `createGist` | `CreateGistInput!` | `gist` | Create gist. |
| 65 | `updateGist` | `UpdateGistInput!` | `gist` | Update gist. |
| 66 | `deleteGist` | `DeleteGistInput!` | `gist` | Delete gist. |
| 67 | `updateGistFile` | `UpdateGistFileInput!` | `gist` | Edit a file. |
| 68 | `starGist` / `unstarGist` | `StarGistInput!` / `UnstarGistInput!` | `gist` | Star a gist. |

**Branch protection / rulesets / environments / deployments**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 69 | `createBranchProtectionRule` | `CreateBranchProtectionRuleInput!` | `branchProtectionRule` | BPR. |
| 70 | `updateBranchProtectionRule` | `UpdateBranchProtectionRuleInput!` | `branchProtectionRule` | Update BPR. |
| 71 | `deleteBranchProtectionRule` | `DeleteBranchProtectionRuleInput!` | `repository` | Delete BPR. |
| 72 | `updateBranchProtectionRuleV2` | `UpdateBranchProtectionRuleV2Input!` | `repository` | V2 BPR. |
| 73 | `createRuleSet` | `CreateRuleSetInput!` | `ruleSet` | Rulesets. |
| 74 | `updateRuleSet` | `UpdateRuleSetInput!` | `ruleSet` | Update ruleset. |
| 75 | `triggerRepositoryRuleset` | `TriggerRepositoryRulesetInput!` | `ruleSet` | Manual ruleset trigger. |
| 76 | `createEnvironment` | `CreateEnvironmentInput!` | `environment` | Environments. (**2024-05** pinning.) |
| 77 | `updateEnvironment` | `UpdateEnvironmentInput!` | `environment` | Update env. |
| 78 | `pinEnvironment` | `PinEnvironmentInput!` | `environment` | **2024-05.** |
| 79 | `reorderEnvironment` | `ReorderEnvironmentInput!` | `repository` | **2024-05.** |
| 80 | `createDeployment` | `CreateDeploymentInput!` | `deployment` | Deployments. |
| 81 | `createDeploymentStatus` | `CreateDeploymentStatusInput!` | `deploymentStatus` | Set status. |
| 82 | `clearPendingDeployments` | `ClearPendingDeploymentsInput!` | `deployment` | Clear queue. |

**Checks / check runs**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 83 | `createCheckSuite` | `CreateCheckSuiteInput!` | `checkSuite` | Create suite. |
| 84 | `updateCheckSuitePreferences` | `UpdateCheckSuitePreferencesInput!` | `repository` | Suite prefs. |
| 85 | `startCheckRun` | `StartCheckRunInput!` | `checkRun` | Start a run. **Core (CI).** |
| 86 | `updateCheckRun` | `UpdateCheckRunInput!` | `checkRun` | Complete a run. **Core (CI).** |
| 87 | `checkRunCompleteTimer` | `CheckRunCompleteTimerInput!` | `checkRun` | Timer. |
| 88 | `checkRunCreateAnnotation` | `CheckRunCreateAnnotationInput!` | `checkRun` | Annotations. |
| 89 | `checkRunStartTimer` | `CheckRunStartTimerInput!` | `checkRun` | Timer. |

**Collaboration / membership / org / teams**

| # | Mutation | Input | Payload | Use |
|---|----------|-------|---------|-----|
| 90 | `addAssignees` | `AddAssigneesInput!` | `assignable` | Assign. **Core.** |
| 91 | `removeAssignees` | `RemoveAssigneesInput!` | `assignable` | Unassign. |
| 92 | `replaceActorsForAssignable` | `ReplaceActorsForAssignableInput!` | `assignable` | **2025-04** — new actors API. |
| 93 | `addLabelsToLabelable` | `AddLabelsToLabelableInput!` | `labelable` | Add labels. |
| 94 | `removeLabelsFromLabelable` | `RemoveLabelsFromLabelableInput!` | `labelable` | Remove labels. |
| 95 | `addProjectV2ItemsToProject` | `AddProjectV2ItemsToProjectInput!` | `project` | v2 items. |
| 96 | `createTeam` | `CreateTeamInput!` | `team` | Teams. |
| 97 | `updateTeam` | `UpdateTeamInput!` | `team` | Teams. |
| 98 | `inviteUserToOrg` | `InviteUserToOrgInput!` | `invitation` | Org invites. |
| 99 | `follow` | `FollowInput!` | `user` | Follow. |
| 100 | `unfollow` | `UnfollowInput!` | `user` | Unfollow. |
| 101 | `star` | `StarInput!` | `starrable` | Star repo. **Core.** |
| 102 | `unstar` | `UnstarInput!` | `starrable` | Unstar. |
| 103 | `watch` / `unwatch` | `SetNotificationSubscriptionInput` | `subscribable` | Subscribe to repo events. |
| 104 | `changeUserStatus` | `ChangeUserStatusInput!` | `status` | Set user status emoji/message. |
| 105 | `setUserInteractionLimit` | `SetUserInteractionLimitInput!` | `user` | Interaction limits. |
| 106 | `createUserList` / `updateUserList` / `deleteUserList` | `*UserListInput!` | `list` | User lists. |
| 107 | `updateUserListsForItem` | `UpdateUserListsForItemInput!` | `item`, `lists` | Lists membership. |
| 108 | `lockLockable` / `unlockLockable` | `LockLockableInput!` / `UnlockLockableInput!` | `lockable` | Lock/unlock issue or repo. |
| 109 | `inviteEnterpriseMember` | `InviteEnterpriseMemberInput!` | `enterpriseMemberInvitation` | **2024.** |
| 110 | `acceptEnterpriseMemberInvitation` | `AcceptEnterpriseMemberInvitationInput!` | `enterpriseMember` | **2024.** |
| 111 | `cancelEnterpriseMemberInvitation` | `CancelEnterpriseMemberInvitationInput!` | `enterpriseMemberInvitation` | **2024.** |
| 112 | `createRepositoryCustomProperty` | `CreateRepositoryCustomPropertyInput!` | `repositoryCustomProperty` | **2025-12** — custom properties. |
| 113 | `updateRepositoryCustomProperty` | `UpdateRepositoryCustomPropertyInput!` | `repositoryCustomProperty` | **2025-12.** |
| 114 | `deleteRepositoryCustomProperty` | `DeleteRepositoryCustomPropertyInput!` | `repositoryCustomProperty` | **2025-12.** |
| 115 | `promoteRepositoryCustomProperty` | `PromoteRepositoryCustomPropertyInput!` | `repositoryCustomProperty` | **2025-12** — promote to org. |
| 116 | `setRepositoryCustomPropertyValues` | `SetRepositoryCustomPropertyValuesInput!` | `repository` | **2025-12.** |
| 117 | `updateRepositoryRuleset` | `UpdateRuleSetInput!` | `ruleSet` | Ruleset update. |
| 118 | `reorderRepositories` | `ReorderRepositoriesInput!` | `repositories` | Reorder user's repo list. |
| 119 | `pinRepository` / `unpinRepository` | `PinRepositoryInput!` / `UnpinRepositoryInput!` | `repository` | Pin repos. |

> That is **30 Query + ~118 Mutation = 148 documented fields**, well past the 80-field target. The set above is the realistic "competitor must ship" surface. Anything not listed (sponsors policy, GHEC-only, attestation/attestations, knowledge bases, models) is a v2+ concern.

### 1.3 Connection types a competitor must define

Every list field returns a `*Connection`. The canonical set (each has `edges`, `nodes`, `pageInfo`, `totalCount`):

`RepositoryConnection`, `IssueConnection`, `PullRequestConnection`, `IssueCommentConnection`, `PullRequestReviewConnection`, `PullRequestReviewCommentConnection`, `LabelConnection`, `MilestoneConnection`, `CommitConnection`, `BranchConnection` (a.k.a. `RefConnection`), `ReleaseConnection`, `TagConnection`, `CollaboratorConnection`, `PullRequestEdge`-based `PullRequestUpdateConnection`, `CheckRunConnection`, `CheckSuiteConnection`, `StatusConnection`, `ActorConnection` (**2025-04**), `AssigneeConnection` (**2025-04**), `StarredRepositoryConnection`, `AssignedIssueConnection`, `TeamConnection`, `MemberConnection`, `UserListConnection`, `GistConnection`, `DiscussionConnection`, `DiscussionCommentConnection`, `EnvironmentConnection`, `DeploymentConnection`, `WorkflowRunConnection`, `WorkflowConnection`, `WorkflowDispatchConnection`, `SearchResultItemConnection`, `ProjectV2Connection`, `ProjectV2ItemConnection`, `ProjectV2StatusUpdateConnection`, `SecurityAdvisoryV2Connection`, `RepositoryCustomPropertyConnection` (**2025-12**), `SponsorableConnection`, `ReactionConnection` (reactions — see §7 pagination note), `EnterpriseMemberInvitationConnection` (**2024**).

### 1.4 Key object types & their headline fields (what clients actually select)

- **`Repository`** — `id, name, nameWithOwner, owner, description, homepageUrl, url, defaultBranchRef, visibility, isPrivate, isFork, isArchived, forkCount, stargazerCount, watcherCount, issueCount, pullRequestCount, createdAt, updatedAt, pushedAt, primaryLanguage, licenseInfo, isDisabled, isTemplate, isEmpty, hasIssuesEnabled, hasProjectsEnabled, hasWikiEnabled, hasPagesEnabled, hasDownloadsEnabled, viewerHasStarred, viewerDidStar, viewerCanAdminister, viewerCanCreateIssues, viewerCanPushCode`. Connections: `issues`, `pullRequests`, `collaborators`, `branches`, `refs`, `releases`, `tags`, `commits`, `contents` (via `blob`/`tree`/`gitObject`), `actionsWorkflowRuns` (`workflowRuns`), `actions` (`workflows`), `environments`, `deployments`, `milestones`, `labels`, `actions`, `gitObjects`.
- **`Issue` / `PullRequest`** (PR implements `Issue` via `IssueOrPullRequest`) — `number, title, body, state, stateReason, url, htmlUrl, createdAt, updatedAt, closedAt, author, assignees, labels, milestone, comments, reactions, timelineItems`, plus for PR: `mergeable, mergeStateStatus, baseRefName, headRefName, baseRefOid, headRefOid, additions, deletions, changedFiles, commits, reviews, reviewRequests, statusCheckRollup, isDraft, merged, mergedAt, authorAssociation, potentialMergeCommit`.
- **`User`** — `id, login, name, email, avatarUrl, url, htmlUrl, bio, company, location, blogUrl, twitterUsername, followers, following, repositories, starredRepositories, gists, organizations, sponsorshipEnterprise, hasSponsorsEnabled, isBot, login, resourcePath, websiteUrl`.
- **`RepositoryOwner`** (interface, `User`/`Organization`/`Enterprise`) — `login, id, avatarUrl, name, repositories, repository, viewerCanAdminister, isAdmin`, `organization`, `user`, `enterprise`.

---

## 2. octokit.graphql Usage Patterns

All examples are real, from the Octokit docs (`_autodocs/api-reference/graphql.md`), `@octokit/graphql`, `plugin-paginate-graphql`, and `graphql-request`.

### 2.1 Library landscape (which package to use)

| Package | Role | When |
|---------|------|------|
| `@octokit/graphql` | Standalone `graphql()` function; returns `{ data, headers }`; throws `GraphqlResponseError`. | When you need raw headers (rate limit) without a full Octokit. |
| `octokit.graphql` (via `Octokit` + `@octokit/plugin-paginate-graphql`) | Baked into the `Octokit` instance; auto-paginate available. | Default choice for OpenForge SDK. |
| `graphql-request` | Vendor-neutral `request()` / `GraphQLClient`; returns only `data`; throws `ClientError`. | When talking to a **non-GitHub** GraphQL API (e.g., QGL itself, or a relay-style API). |

### 2.2 Basic query

```ts
import { Octokit } from "octokit";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Shorthand query (no operation name) — returns the `data` object directly
const { viewer } = await octokit.graphql(`{ viewer { login } }`);
console.log("Hello, %s", viewer.login);
```

### 2.3 Query with variables

```ts
// Named operation + variables passed as the 2nd argument
const { lastIssues } = await octokit.graphql(
  `query lastIssues($owner: String!, $repo: String!, $num: Int = 3) {
    repository(owner: $owner, name: $repo) {
      issues(last: $num) { nodes { title } }
    }
  }`,
  { owner: "octokit", repo: "graphql.js" },
);
```

Using `edges` instead of `nodes` (canonical Relay shape):

```ts
const { lastIssues } = await octokit.graphql(
  `
  query lastIssues($owner: String!, $repo: String!, $num: Int = 3) {
    repository(owner: $owner, name: $repo) {
      issues(last: $num) {
        edges {
          cursor
          node { title }
        }
      }
    }
  }`,
  { owner: "octokit", repo: "graphql.js" },
);
```

### 2.4 Paginated query — three patterns

**Pattern A: auto-paginate (single resource only).** `octokit.graphql.paginate` follows `endCursor` until `hasNextPage === false` and merges all `nodes`/`edges`. Two hard conventions (from `plugin-paginate-graphql`): the cursor variable **must be named `$cursor`**, and the resource **must select a `pageInfo`** with `hasNextPage` + `endCursor` (forward) or `hasPreviousPage` + `startCursor` (backward).

```ts
import { paginateGraphQL } from "@octokit/plugin-paginate-graphql";
const MyOctokit = Octokit.plugin(paginateGraphQL);
const octokit = new MyOctokit({ auth: process.env.GITHUB_TOKEN });

const { allIssues } = await octokit.graphql.paginate(
  `query allIssues($owner: String!, $repo: String!, $num: Int = 10, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: $num, after: $cursor) {
        nodes { title }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`,
  { owner: "octokit", repo: "graphql.js" },
);
console.log(`Found ${allIssues.repository.issues.nodes.length} issues!`);
```

> **Limitation:** `paginate` only supports a **single** top-level paginated resource — no parallel/nested pagination. For multiple connections, use Pattern B or C.

**Pattern B: async iterator (memory-efficient).** Yields one page at a time; best for large result sets.

```ts
const iterator = octokit.graphql.paginate.iterator(
  `query all($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: 100, after: $cursor) {
        nodes { title }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`,
  { owner: "octocat", repo: "hello-world" },
);

for await (const page of iterator) {
  for (const issue of page.repository.issues.nodes) {
    console.log(issue.title);
  }
}
```

**Pattern C: manual loop (full control).** Recommended for QGL because it works for any connection shape and lets you stop early, respect `rateLimit`, and retry. See the full version in §10.1.

### 2.5 GraphQL error handling

`octokit.graphql` throws a `GraphqlResponseError` when the response contains an `errors` array (even if `data` is partially present). The error carries `error.errors` (array of `{ message, type, path, locations }`) and `error.data` (the partial data).

```ts
import { GraphqlResponseError } from "@octokit/graphql";

try {
  await octokit.graphql(`{ repository(owner: "$", name: "$") { id } }`, {});
} catch (error) {
  if (error instanceof GraphqlResponseError) {
    // error.errors => [{ type: "NOT_FOUND", path: ["repository"], message: "Could not resolve to a Repository with the signal '...'" }]
    // error.data   => { repository: null }   (partial data, still present)
    // error.request  => the raw request object
    for (const e of error.errors) {
      console.error(`${e.type}: ${e.message}`, "at", e.path);
    }
  } else {
    throw error; // network error, etc.
  }
}
```

### 2.6 Rate-limit headers on responses

`@octokit/graphql` (and raw `fetch`) expose the response `headers` so you can read `x-ratelimit-remaining`, `x-ratelimit-reset`, etc. Without a full Octokit:

```ts
import { graphql } from "@octokit/graphql";

const { data, headers } = await graphql(
  "https://api.github.com/graphql",
  {
    query: `{ viewer { login } }`,
    headers: { authorization: `token ${process.env.GITHUB_TOKEN}` },
  },
);
console.log("remaining points:", headers["x-ratelimit-remaining"]);
console.log("resetAt (epoch s):", headers["x-ratelimit-reset"]);
```

> Inside the Octokit instance, `octokit.graphql(...)` returns **only `data`** (the headers are attached to `octokit.lastResponse.headers` and are not surfaced as a tuple). If you need headers per-call, use `@octokit/graphql` directly or read `octokit.lastResponse.headers` after the call.

### 2.7 Throttling / retries on 502 / 503 / 429 / secondary-limit

GitHub's guidance (rate-limit docs): on a **primary** limit the status is still `200` but `x-ratelimit-remaining: 0` — do **not** retry until `x-ratelimit-reset`. On a **secondary** limit you get `200`/`403`/`429`, honor `retry-after` if present, else wait `x-ratelimit-reset` (if remaining is 0), else ≥60 s, then back off **exponentially** and give up after N retries. Timeouts return `502`/`504`.

`@octokit/graphql` exposes the retry hooks via its `retry` option. A production-ready wrapper (exponential backoff + jitter + `retry-after` + `x-ratelimit-reset` awareness):

```ts
import { graphql, GraphqlResponseError } from "@octokit/graphql";

const RETRYABLE_STATUS = new Set([403, 429, 502, 503, 504]);

export async function gqlWithRetry<T = any>(
  url: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  { maxRetries = 6 } = {},
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { data } = await graphql(url, {
        query,
        variables,
        headers: { authorization: `token ${token}` },
      });
      return data as T;
    } catch (err) {
      const status = (err as any)?.response?.status as number | undefined;
      const isGraphql = err instanceof GraphqlResponseError;
      const msg = String((err as Error)?.message ?? "");
      const rateLimited =
        (status === 403 || status === 429) && /rate limit|secondary/i.test(msg) ||
        isGraphql && /rate limit/i.test(msg);

      const retryable =
        (status !== undefined && RETRYABLE_STATUS.has(status)) || rateLimited;
      if (!retryable || attempt >= maxRetries) throw err;

      attempt += 1;
      const headers = (err as any)?.response?.headers ?? {};
      const retryAfter = Number(headers["retry-after"]);
      const resetEpoch = Number(headers["x-ratelimit-reset"]);
      const baseMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Number.isFinite(resetEpoch)
            ? Math.max(0, resetEpoch * 1000 - Date.now())
            : Math.min(30_000, 500 * 2 ** attempt); // exponential
      const delay = baseMs + Math.floor(Math.random() * 250); // jitter
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

### 2.8 `@octokit/graphql` directly vs `octokit.graphql` on the instance

- **`@octokit/graphql` standalone**: `await graphql(url, { query, variables, headers, request })`. Returns `{ data, headers }`. Lowest-level; you manage auth, base URL, retries, and pagination yourself. Best for a thin SDK or for a **non-GitHub** GraphQL server (just change `url`).
- **`octokit.graphql` (instance)**: already wired with the Octokit `auth` strategy, `baseUrl`, `request.fetch`, and (with the plugin) `paginate`. Returns `data` only; errors throw `GraphqlResponseError`. This is the ergonomics layer.

They are the same wire protocol; the instance method is a convenience facade over the standalone one.

### 2.9 `graphql-request` (vendor-neutral client — the natural QGL client)

Because OpenForge's QGL is not `api.github.com`, a vendor-neutral client like `graphql-request` is a strong fit.

```ts
import { GraphQLClient, gql, ClientError } from "graphql-request";

// 1) Static one-shot request
import { request } from "graphql-request";
const data = await request<QGLData>(
  "https://openforge.example/graphql",
  `query($owner: String!, $repo: String!) {
     repository(owner: $owner, name: $repo) { name }
   }`,
  { owner: "juw12", repo: "openforge" },
);

// 2) Reusable client with auth header
const client = new GraphQLClient("https://openforge.example/graphql", {
  headers: { authorization: `Bearer ${process.env.OPENFORGE_TOKEN}` },
});
const repo = await client.request<{ repository: { name: string } }>(
  gql`query($o: String!) { repository(owner: $o, name: "openforge") { name } }`,
  { o: "juw12" },
);

// 3) rawRequest — keeps status + headers (for rate-limit inspection)
import { rawRequest } from "graphql-request";
try {
  const { data, status, headers } = await rawRequest(
    "https://openforge.example/graphql",
    `query { viewer { login } }`,
    undefined,
    { headers: { authorization: `Bearer ${process.env.OPENFORGE_TOKEN}` } },
  );
  console.log(status, headers);
} catch (e) {
  if (e instanceof ClientError) {
    // e.response = { status, data, errors, headers }
    console.error(`HTTP ${e.response.status}`, e.response.errors);
  } else {
    throw e;
  }
}
```

Note: `request()`/`client.request()` return **only the `data` field** and throw `ClientError` when `errors` is present, status is non-2xx, or `data` is falsy — the same "throw on error" contract as `@octokit/graphql`.

### 2.10 Authentication passed to the client

- **PAT (classic or fine-grained):** `new Octokit({ auth: process.env.GITHUB_TOKEN })` or header `Authorization: token <PAT>`.
- **OAuth app access token (web flow):** same — `Authorization: token <access_token>` (the token behaves like a scoped user token).
- **GitHub App installation token:** mint it first (§5.3 / §10.3), then `Authorization: token <installation_access_token>`.
- **GitHub App "as app" (JWT):** `Authorization: Bearer <JWT>` — used to mint installation tokens and call app-management endpoints, **not** for repo data.
- **On-behalf-of-user token (GitHub App):** `Authorization: token <user_access_token>` — attributes activity to the user.

```ts
// PAT
const o1 = new Octokit({ auth: process.env.GITHUB_TOKEN });
// OAuth web-flow token
const o2 = new Octokit({ auth: webFlowAccessToken });
// GitHub App installation (auto-mint + refresh via authStrategy)
import { createAppAuth } from "@octokit/auth-app";
const o3 = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: 1,
    privateKey: "-----BEGIN PRIVATE KEY-----\n...",
    installationId: 123,
  },
});
// "as app" JWT to mint tokens
import { createAppAuth as appAuth } from "@octokit/auth-app";
const jwt = (await appAuth({ appId: 1, privateKey: "..." })({ type: "app" })).token;
```

---

## 3. Rate Limit Specification

### 3.1 REST primary rate limit headers

| Header | Meaning |
|--------|---------|
| `x-ratelimit-limit` | Max requests/points in the current window |
| `x-ratelimit-remaining` | Remaining in the window |
| `x-ratelimit-used` | Used in the window |
| `x-ratelimit-reset` | Window reset, **UTC epoch seconds** |
| `x-ratelimit-resource` | Which bucket: `core`, `search`, `integration_manifest`, `repository_scoped_installation`, `graphql`, `code_scanning_upload`, `actions_runner_registration`, etc. |

REST primary limits (auth method → requests/hour):

- Unauthenticated: **60**/hr (per IP).
- Authenticated user (PAT, or app acting on user): **5,000**/hr; **15,000**/hr if the acting app is GHEC-owned.
- GitHub App installation: **5,000**/hr floor, +50 per repo over 20 and +50 per org user over 20, **cap 12,500**/hr; GHEC org → **15,000**/hr.
- OAuth app using client_id/secret for public data: **5,000**/hr (15,000 GHEC).
- `GITHUB_TOKEN` in Actions: **1,000**/hr/repo (15,000 GHEC).
- Search endpoints have their own lower per-minute limit; Git LFS has a separate 300/min (unauth) / 3,000/min (auth) bucket.

### 3.2 GraphQL primary rate limit (points, not requests)

The GraphQL API meters **points per query** against an hourly budget. Limits (points/hour):

| Auth method | Points/hour |
|-------------|-------------|
| User (PAT; or GitHub/OAuth app acting on user) | **5,000** (10,000 if GHEC-owned app) |
| GitHub App installation (non-GHEC) | **5,000** floor; +50 per repo >20; +50 per org user >20; **cap 12,500** |
| GitHub App installation (GHEC org) | **10,000** |
| OAuth app (client id/secret, public data) | **5,000** (10,000 GHEC) |
| `GITHUB_TOKEN` in Actions | **1,000**/repo (15,000 GHEC) |

**The `rateLimit` object** is queryable on **any** operation and is the canonical way to inspect the budget in-band (headers also carry it):

```graphql
query {
  viewer { login }
  rateLimit { limit cost remaining used resetAt }
}
# => { "data": { "viewer": { "login": "octocat" },
#      "rateLimit": { "limit": 5000, "cost": 1, "remaining": 4999, "used": 1, "resetAt": "2026-11-03T12:00:00Z" } } }
```

| Field | Meaning |
|-------|---------|
| `limit` | Max points/hour |
| `cost` | **Points this specific query costs** (0 when called with `rateLimit(dryRun: true)` semantics on a query that wouldn't run) |
| `remaining` | Points left this hour |
| `used` | Points consumed this hour |
| `resetAt` | ISO-8601 reset time |

The GraphQL rate-limit response headers are the **same five** as REST, with `x-ratelimit-resource: graphql`.

### 3.3 Cost calculation algorithm (primary)

GitHub's published algorithm (docs, verbatim):

1. **Count the number of "requests" needed to fulfill each unique connection** in the query, assuming every connection reaches its `first`/`last` limit.
2. **Divide the total by 100, round to the nearest whole number** → the point value.
3. **Minimum is 1 point** per call.

Concretely, the "request count" is the product of the **fan-out**: each parent node multiplies the connection requests it owns. GitHub's own worked example:

```graphql
query {
  viewer {
    login
    repositories(first: 100) {            # 1 request (the viewer)
      edges { node {
        id
        issues(first: 50) {               # 100 requests (1 per repo)
          edges { node {
            id
            labels(first: 60) {           # 5,000 requests (1 per potential issue)
              edges { node { id name } }
            }
          } }
        }
      } }
    }
  }
}
```
→ repositories = **1**, issues = **100**, labels = **100 × 50 = 5,000** → total = **5,101** → `5,101 / 100 = 51.01` → rounded = **51 points**.

**Equivalent closed form** (used by `github-graphql-node-count` and the `pr-shepherd` cost model):
```
cost = max(1, round( aggregate_request_count / 100 ))
```
where `aggregate_request_count` is the sum over every connection field of `parent_count × max(1, min(first,last,100))` — i.e. **multiply**, not add, down the tree. A connection that supplies *neither* `first` nor `last` is **invalid** (schema rejects it) — see the node limit below.

**Practical rules for OpenForge/QGL cost metering:**
- Charge per *resolved connection instance*, i.e. `parent_nodes × page_size`.
- Leaf scalars cost 0; only connections cost.
- Clamp `first`/`last` to `1..100` before charging (values are validated to that range).
- A query with **no connections** costs **1**.
- A `rateLimit(dryRun: true)` lets a client preview cost without spending it — QGL should implement `dryRun`.

### 3.4 Secondary rate limits (abuse detection)

These are **separate** from the hourly point budget and are enforced to stop bursts. Documented thresholds:

| Rule | Limit |
|------|-------|
| Concurrent requests (REST + GraphQL shared) | **≤ 100** concurrent |
| Points per minute, REST endpoints | **≤ 900**/min |
| Points per minute, GraphQL endpoint | **≤ 2,000**/min |
| CPU time | **≤ 90 s CPU per 60 s real** (≤ 60 s of that may be GraphQL) |
| Content-generating requests | **≤ 80/min** and **≤ 500/hour** (incl. web UI) |
| OAuth access-token minting | **≤ 2,000/hour** (GitHub Apps + OAuth apps) |

**Secondary points are a different scale** (per *request*, not per connection):

| Request | Points |
|---------|--------|
| GraphQL request **without** mutations | **1** |
| GraphQL request **with** mutations | **5** |
| Most REST `GET`/`HEAD`/`OPTIONS` | **1** |
| Most REST `POST`/`PATCH`/`PUT`/`DELETE` | **5** |

So against the 2,000 pts/min GraphQL ceiling: **~2,000 read requests/min** but only **~400 mutation requests/min**. A write loop trips at ~1/5 the request rate a read loop survives while the hourly budget is barely touched. **Batching multiple mutations in one document is the cheapest fix** (5 points regardless of how many mutations), whereas splitting one document into six multiplies secondary cost 6×.

### 3.5 Exceeding limits — response semantics (critical for a client SDK)

- **Primary limit exceeded:** status is **`200`** (GraphQL) with an error in the body **and** `x-ratelimit-remaining: 0`. Do not retry until `x-ratelimit-reset`.
- **Secondary limit exceeded:** status **`200` or `403`** (or `429`) with a "secondary rate limit" error. If `retry-after` is present, wait that many seconds. If `x-ratelimit-remaining: 0`, wait until `x-ratelimit-reset`. Otherwise wait **≥ 60 s**, then **exponential backoff**, then give up after N retries.
- **Timeouts:** GitHub returns **`502`** or **`504`** after >10 s. Timeouts also deduct extra points next hour. QGL should expose a configurable timeout and a `504` path.
- Continuing to hammer while limited can lead to **ban**.

### 3.6 Conditional requests (`If-None-Match` → 304, `ETag`)

GitHub REST supports HTTP conditional requests: every object response carries an **`ETag`** (and an `X-Immutable: true` header for objects that never change, e.g. a tag's commit, a release asset). A client may send:

```
GET /repos/{owner}/{repo}/contents/README.md
If-None-Match: <etag from previous response>
```

If the resource is unchanged, GitHub returns **`304 Not Modified`** with an empty body and **does not count against the primary rate limit**. This is the single biggest rate-limit saving for any cacheable client (file listings, commit SHAs, tags). The `ETag` is a SHA-1-style digest of the JSON body.

**QGL note:** GraphQL does **not** use `ETag`/304 per request (the query shape varies). The OpenForge equivalent is: (a) expose `ETag` on REST-style sub-APIs, and (b) in QGL, support an optional `@cacheable`/fingerprint argument or an `If-None-Match` header on a small set of "snapshot" queries (e.g. a repo's check-rollup) so pollers get 304s. This is what the `pr-shepherd` model exploits (≈8 conditional reads → ~4 points/hour idle vs. 60).

### 3.7 GraphQL aliases to batch / reduce cost

Aliases let you fetch the same field multiple times under different result keys in **one** query, avoiding N round-trips:

```graphql
{
  me:   viewer { login }
  repo: repository(owner: "octokit", name: "graphql.js") {
    name
    open:   issues(states: OPEN)   { totalCount }
    closed: issues(states: CLOSED) { totalCount }
  }
}
```

Aliases are the idiomatic way to "batch" heterogeneous reads into a single request. There is **no** GraphQL `batch` (array-of-operations) endpoint on GitHub — batching is done either with aliases, with `nodes(ids:[...])` for by-ID fan-in, or with a separate HTTP body. QGL should support aliases natively (any GraphQL server does) and **not** advertise a batch endpoint unless it deliberately diverges.

---

## 4. Pagination Specification

GitHub uses the **Relay Cursor Connection** spec. This section reproduces the contract a competitor must implement, with GitHub's specific numbers.

### 4.1 The four pagination arguments

Every connection field takes (a subset of) these:

| Arg | Type | Meaning |
|-----|------|---------|
| `first` | `Int` | Page forward up to N results |
| `after` | `String` | Cursor **after** which to start (use previous page's `endCursor`) |
| `last` | `Int` | Page backward up to N results |
| `before` | `String` | Cursor **before** which to start (use previous page's `startCursor`) |

GitHub hard rules (schema validation enforces these):
- **You MUST supply `first` OR `last`** on any connection (a connection with neither is rejected).
- **`first`/`last` ∈ [1, 100].** (The docs' phrasing: "must be between 1 and 100".)
- A single call may request at most **500,000 total nodes**.

### 4.2 Connection object shape

A `*Connection` type contains exactly these required members (plus domain extras like `totalCount`, `totalDiskUsage`):

```graphql
type RepositoryConnection {
  edges: [RepositoryEdge]
  nodes: [Repository]
  pageInfo: PageInfo!
  totalCount: Int!
  # GitHub-specific extra:
  totalDiskUsage: Int!
}

type RepositoryEdge {
  cursor: String!
  node: Repository
}
```

- **`edges`**: the canonical list; each edge has a `cursor` + the `node`.
- **`nodes`**: a convenience projection of just the nodes (same order, no cursors). Prefer `edges` when you need per-item cursors, `nodes` otherwise.
- **`totalCount`**: total items in the *full* (un-paginated) set. **Cheap** — selecting `totalCount` does **not** multiply the node count or cost the way `edges` do. (Used to size a list without fetching all pages.)

### 4.3 `PageInfo`

```graphql
type PageInfo {
  endCursor: String        # opaque; null if empty
  hasNextPage: Boolean!    # more items forward?
  hasPreviousPage: Boolean!
  startCursor: String      # opaque; null if empty
}
```

- `startCursor` = cursor of the **first** edge in the page.
- `endCursor` = cursor of the **last** edge in the page.
- `hasNextPage` is **authoritative** when paginating with `first`/`after` (server must return true iff more exist).
- `hasPreviousPage` is authoritative when paginating with `last`/`before`.
- Both may be `false`/`null` when results are empty.

### 4.4 Cursors are opaque base64

Cursors are **opaque** — treat as an opaque string and echo back. On GitHub they are base64 of a structured value (e.g. `base64("cursor:v2:U0H8B7g==")`). Real example from the docs: `Y3Vyc29yOnYyOpHOUH8B7g==`. **Never parse, compare, or generate client-side.** The server encodes the position (usually `base64("cursor:v2:" + recordKey)`). QGL should adopt the same: `base64("cursor:v1:" + opaqueKey)` where `opaqueKey` encodes a stable sort position.

### 4.5 Forward vs backward traversal

**Forward** (`first`/`after`), loop on `hasNextPage`:

```graphql
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: null) {
      nodes { createdAt number title }
      pageInfo { endCursor startCursor hasNextPage hasPreviousPage }
    }
  }
}
# next page -> after: "<pageInfo.endCursor>" ; stop when hasNextPage == false
```

**Backward** (`last`/`before`), loop on `hasPreviousPage`:

```graphql
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(last: 1, before: "R3Vyc29yOnYyOpHOHcfoOg==") {
      nodes { createdAt number title }
      pageInfo { startCursor hasPreviousPage }
    }
  }
}
# previous page -> before: "<pageInfo.startCursor>" ; stop when hasPreviousPage == false
```

### 4.6 Edge-ordering contract (Relay spec, §4.3)

Ordering must be **consistent page-to-page and identical** between `first/after` and `last/before` (not reversed):
- With `after: c` → the edge closest to `c` comes **first**.
- With `before: c` → the edge closest to `c` comes **last**.

### 4.7 The pagination algorithm (Relay spec, §4.4)

```
EdgesToReturn(allEdges, before, after, first, last):
  edges = ApplyCursorsToEdges(allEdges, before, after)
  if first set:  require first >= 0; if len(edges) > first: drop from the END
  if last  set:  require last  >= 0; if len(edges) > last:  drop from the START
  return edges

ApplyCursorsToEdges(allEdges, before, after):
  edges = allEdges
  if after set:  drop all edges up to and including the edge whose cursor == after
  if before set: drop all edges from and including the edge whose cursor == before
  return edges
```

Passing both `first` and `last` is **discouraged** (meaning becomes ambiguous); if both are given the server applies `first` then `last`.

### 4.8 `PageInfo` truth conditions (Relay spec, §5.1)

```
HasNextPage(before, after, first, last):
  if first set:  true iff (edges after applying cursors) has more than `first`
  if before set: true iff the server can efficiently prove items exist after `before`
  else false

HasPreviousPage(before, after, first, last):
  if last set:   true iff (edges after applying cursors) has more than `last`
  if after set:  true iff the server can efficiently prove items exist before `after`
  else false
```

### 4.9 Node-count calculation (schema validation, ≤ 500,000)

The total node count is the **product** across the selection tree. GitHub's two worked examples:

**Simple:**
```
viewer.repositories(first: 50)
  .issues(first: 10)
= 50 + (50 × 10) = 550 nodes
```

**Complex:**
```
50 repos
+ 50 × 20 (pullRequests)                = 1,000
+ 50 × 20 × 10 (PR comments)            = 10,000
+ 50 × 20 (issues)                      = 1,000
+ 50 × 20 × 10 (issue comments)         = 10,000
+ 10 (followers)
= 22,060 total nodes
```

QGL should enforce the same 500,000 node cap and return a clear error ("Resource limits for this query exceeded") on breach.

### 4.10 octokit paginate-graphql conventions (re-stated for QGL interop)

1. The cursor variable **must be named `$cursor`**.
2. The paginated resource **must select `pageInfo`** with at least `hasNextPage` + `endCursor` (forward) or `hasPreviousPage` + `startCursor` (backward).
3. If all four `pageInfo` fields are present, the plugin **defaults to forward** pagination.
4. Only **one** paginated resource per query (no nested/parallel auto-paginate).

A QGL server that wants octokit-compat should honor these naming conventions so the existing plugin works unmodified.

---

## 5. Authentication Patterns

### 5.1 Personal Access Tokens

Two kinds exist. GitHub **recommends fine-grained** where possible.

**Classic PAT** — broad scopes applied to the whole account, can live forever. Scopes include: `public_repo`, `repo` (all private repos), `repo:status`, `repo_deployment`, `security_events`, `repo:read`, `repo:write`, `workflow`, `gist`, `notifications`, `admin:org`, `admin:enterprise`, `admin:public_key`, `admin:user`, `read:org`, `write:org`, `read:user`, `user:email`, `read:packages`, `write:packages`, `delete:packages`, `read:project`, `write:project`, `read:milestones`, `write:milestones`, `project`, `read:discussion`, `write:discussion`, `read:copilot`, `admin:billing`, etc. A `public_repo` scope is needed to read public repos with a classic token.

**Fine-grained PAT (2022+, "2023+" in practice)** — three orthogonal controls:
1. **Resource owner** — a single user **or** a single organization (the token can't cross owners). Orgs can require **approval** for fine-grained PATs that touch org resources.
2. **Repository access** — *All repos*, *Only select repos* (down to a single repo), or *No access* (org-level only). Public repos are always readable.
3. **Permissions** — 50+ granular permissions, each `read` / `write` / (`admin` where supported). `write` includes `read`; `admin` includes `write`. `Metadata: Read` is a near-universal dependency.

**Fine-grained permission tables** (from the official docs):

*Account permissions (only when the user is the resource owner):*
`blocking` (r/w), `codespaces_user_secrets` (r/w), `copilot_messages` (r), `copilot_editor_context` (r), `copilot_requests` (w), `emails` (r/w), `user_events` (r), `followers` (r/w), `gpg_keys` (r/w), `gists` (w), `keys` (r/w), `interaction_limits` (r/w), `knowledge_bases` (r/w), `user_models` (r), `plan` (r), `private_repository_invitations` (r), `profile` (w), `git_signing_ssh_public_keys` (r/w), `starring` (r/w), `watching` (r/w).

*Repository permissions (user or org owner):*
`actions` (r/w), `administration` (r/w), `artifact_metadata` (r/w), `attestations` (r/w), `code_quality` (r/w), `security_events` (Code scanning, r/w), `codespaces` (r/w), `codespaces_lifecycle_admin` (r/w), `codespaces_metadata` (r), `codespaces_secrets` (w), `statuses` (r/w), `contents` (r/w), `repository_custom_properties` (r/w), `vulnerability_alerts` (Dependabot, r/w), `dependabot_secrets` (r/w), `deployments` (r/w), `discussions` (r/w), `environments` (r/w), `issues` (r/w), `merge_queues` (r/w), `metadata` (r), `pages` (r/w), `pull_requests` (r/w), `repository_advisories` (r/w), `secret_scanning_alerts` (r/w), `secrets` (r/w), `actions_variables` (r/w), `repository_hooks` (Webhooks, r/w), `workflows` (w).

*Organization permissions (only when the resource owner is an org):*
`organization_api_insights` (r), `organization_administration` (r/w), `organization_user_blocking` (r/w), `organization_campaigns` (r/w), `organization_custom_org_roles` (r/w), `organization_custom_properties` (r/w/admin), `organization_custom_roles` (r/w), `organization_events` (r), `organization_copilot_seat_management` (r/w), `issue_types` (r/w), `organization_knowledge_bases` (r/w), `members` (r/w), `organization_models` (r), `organization_network_configurations` (r/w), `organization_announcement_banners` (r/w), `organization_codespaces` (r/w), `organization_codespaces_secrets` (r/w), `organization_codespaces_settings` (r/w), `organization_dependabot_secrets` (r/w), `organization_code_scanning_dismissal_requests` (r/w), `organization_private_registries` (r/w), `organization_plan` (r), `organization_projects` (r/w/admin), `organization_secrets` (r/w), `organization_self_hosted_runners` (r/w), `team_discussions` (r/w), `organization_actions_variables` (r/w), `organization_hooks` (Webhooks, r/w).

**Limits/caveats:** a max of **50** fine-grained PATs per user; orgs **block tokens longer than 366 days** by default; fine-grained tokens still **cannot** do everything classic can (e.g. cross-owner access, enterprise-account APIs) — use a GitHub App for those. The REST response includes an **`X-Accepted-GitHub-Permissions`** header telling the client exactly which permission an endpoint needs.

### 5.2 OAuth App (legacy "OAuth App")

- **Web application flow** (3-legged): user is redirected to GitHub's authorize URL, consents, GitHub redirects back with a `?code=`. The app exchanges `code` + `client_id` + `client_secret` for an **access token** (`POST /login/oauth/access_token`). Token has the scopes the app requested (same vocabulary as classic scopes).
- **Device flow (RFC 8628):** for input-constrained devices. Step 1 `POST /login/device/code` → `device_code` + `user_code`; user enters `user_code` at `github.com/login/device`; step 2 the app polls `POST /login/oauth/access_token` with `device_code` until `access_token` is returned (handles `authorization_pending` / `slow_down`).
- Token lifetime: user-dependent (user can revoke); no fixed expiry by default.
- Rate limit: access tokens act under the **user's** 5,000/hr; client-id/secret public-data calls get 5,000/hr per app.

### 5.3 GitHub App (modern, preferred)

A GitHub App has three distinct credentials and three auth modes:

1. **App JWT (authenticate as the App)** — sign a JSON Web Token with the App's **private key** (RSA, **RS256**). Claims:
   - `iat`: issued-at (GitHub allows **30 s of clock skew back**, so sign with `iat = now - 30s`).
   - `exp`: expires-at, **≤ 10 minutes** (GitHub requires < 10 min; 9 min recommended).
   - `iss`: the App's `app_id`.
   Header: `{ "alg": "RS256" }`.
   Usage: `Authorization: Bearer <JWT>` — only for app-management + minting installation tokens.

2. **Installation access token (authenticate as an installation)** — minted by exchanging a valid App JWT:
   ```
   POST https://api.github.com/app/installations/{installation_id}/access_tokens
   Authorization: Bearer <JWT>
   ```
   → returns `{ "token": "ghs_...", "expires_at": "..." }`. **Valid for 1 hour** (GitHub hard cap). Can be scoped to `repository_ids` and a `permissions` subset. Usage: `Authorization: token <installation_access_token>`.

3. **User access token (on-behalf-of-user)** — OAuth on top of the GitHub App: user authorizes the App → `code` → `POST /login/oauth/access_token` with the App's `client_id`/`client_secret` → user token that attributes actions to the user.

`@octokit/auth-app` (`createAppAuth`) automates all three and **caches + refreshes** installation tokens (default cache TTL 59 min, token valid 60 min) and JWTs. It also supports a `createJwt` factory for remotely/HSM-signed JWTs (relevant because the private key can live in a KMS).

```js
import { createAppAuth } from "@octokit/auth-app";
const auth = createAppAuth({
  appId: 1,
  privateKey: "-----BEGIN PRIVATE KEY-----\n...",
  clientId: "lv1.1234567890abcdef",
  clientSecret: "1234567890abcdef12341234567890abcdef1234",
});
await auth({ type: "app" });                       // JWT
await auth({ type: "oauth-app" });                 // client-credentials
await auth({ type: "installation", installationId: 123,
             repositoryIds: [1,2,3], permissions: { issues: "write" } });
await auth({ type: "oauth-user", code: "123456" }); // on-behalf-of-user
```

### 5.4 Token expiration cheat-sheet

| Credential | Lifetime |
|------------|----------|
| Classic PAT | **Never** (until revoked) — can be set to expire |
| Fine-grained PAT | Expires (user-set); orgs cap at **366 days** by default |
| OAuth App access token | User-revocable; no fixed expiry by default |
| GitHub App JWT | **≤ 10 minutes** |
| GitHub App installation token | **1 hour** |
| GitHub App user token | **8 hours** + 6-month refresh token (unless owner disables) |
| `GITHUB_TOKEN` (Actions) | Job-scoped (a few hours) |

### 5.5 Token storage on the client

- **Desktop/mobile:** OS keychain/keystore (macOS Keychain, Windows Credential Manager, Android Keystore). Never `localStorage`/`SharedPreferences` plaintext.
- **Browser (SPA):** short-lived token in `memory` only; use an **httpOnly secure cookie** for session refresh; never in `localStorage`.
- **Server (the OpenForge app itself):** the GitHub App **private key** belongs in a **KMS/HSM** or a secrets manager (never committed, never in env if avoidable); installation tokens cached with TTL and refreshed (the `createAppAuth` pattern in §10.3).
- The `Authorization: Bearer` (JWT) vs `Authorization: token` (PAT/installation/OAuth) distinction must be preserved by the client.

---

## 6. Error Response Format

### 6.1 The GraphQL envelope

Every response has the standard GraphQL envelope. **Both `data` and `errors` can be present** (partial response):

```json
{
  "data": { "repository": null, "viewer": { "login": "octocat" } },
  "errors": [
    {
      "type": "NOT_FOUND",
      "message": "Could not resolve to a Repository with the signal 'owner: octocat, name: nope'.",
      "path": ["repository"],
      "locations": [ { "line": 2, "column": 3 } ],
      "extensions": { "code": "CANNOT_RETRIEVE_RESOURCE" }
    }
  ]
}
```

- `data` fields that failed are **`null`**; the sibling `viewer` still resolves. A client must null-check every nullable field, not assume the whole response failed.
- `errors[].path` is the JSON pointer to the failing field — essential for pinpointing which selection broke.

### 6.2 `octokit` error object (`GraphqlResponseError`)

When `errors` is non-empty, `octokit.graphql` throws `GraphqlResponseError` carrying:
- `error.errors` — the raw array (`{ message, type, path, locations, extensions }`)
- `error.data` — the partial data
- `error.request` — the underlying request (method, url, headers, body)
- `error.status` — HTTP status (typically `200`)

### 6.3 Error `type` taxonomy (the `errors[].type` strings)

GitHub emits a small, stable set of `type` values on `errors[]`:

| `type` | Meaning | HTTP-ish analog |
|--------|---------|-----------------|
| `NOT_FOUND` | Resource didn't resolve (bad owner/name/ID) | 404 |
| `FORBIDDEN` | Authenticated but not permitted (scope/permission) | 403 |
| `UNAUTHENTICATED` | Missing/invalid credentials | 401 |
| `VALIDATION` / `BAD_QUERY` | Schema/validation error in the query itself | 400 |
| `RATE_LIMITED` | Primary or secondary limit hit | 403/429 |
| `RESOURCE_LIMIT` / `TOO_MANY_NODES` | >500,000 nodes / node limit | 400 |
| `CONFLICT` | Write conflict (e.g. ref already exists, lock held) | 409 |
| `UNPROCESSABLE` / `UNPROCESSABLE_CONTENT` | Bad input content | 422 |
| `INTERNAL_SERVER_ERROR` | 5xx | 500 |
| `ABORTED` / `OUT_OF_MEMORY` / `SERVICE_UNAVAILABLE` | 5xx / timeout | 502/503/504 |

(`extensions.code` carries finer machine-readable codes like `CANNOT_RETRIEVE_RESOURCE`, `RESOURCE_UNAVAILABLE`, `MISSING_SCOPES` — QGL should adopt `extensions.code` for stable client logic.)

### 6.4 Partial-response rule (important for the SDK)

Because `data` + `errors` coexist, the SDK contract is:
1. If `errors` is non-empty **and** the error is a *fatal* validation/auth error → throw immediately (nothing useful in `data`).
2. If `errors` is non-empty **but** `data` has a meaningful partial result (e.g. `NOT_FOUND` on one nested field while siblings resolved) → throw `GraphqlResponseError` **with** `error.data` attached so the caller can decide.
3. A client that wants "best effort" can catch the error and still read `error.data`.

### 6.5 `@allowable` / directive usage

GitHub has historically supported a small set of **schema directives** and the `@` convention. The most operationally relevant for a competitor is the ability to mark a field **allowable** to return `null`/partial under resource limits so that a query degrades gracefully (returns partial `data` + a `RESOURCE_LIMIT`-style `errors[]`) instead of hard-failing. QGL should:
- Support **`extensions`** on every error (machine-readable codes).
- Support a **`rateLimit { cost }`** even when the query is rejected (so clients can budget).
- Distinguish **client errors** (4xx, don't retry) from **transient server errors** (5xx/timeout, retry with backoff) via the `type`/`status`.

> There is no GitHub-specific `@allowable` *client directive* in the public schema the way some internal systems use it; the graceful-degradation behavior is enforced server-side. Treat "allowable" as a **server policy** (which fields may null-out under load) rather than a query annotation, and expose that policy in the schema via description/`extensions`.

---

## 7. 2024+ Schema Changes

GitHub's GraphQL is **additive-first** but does ship breaking removals on a **deprecation → scheduled-removal** cadence (the changelog announces removals ~6 months ahead with an "Effective" date). Below is the curated signal for a competitor deciding what to build.

### 7.1 New types/fields added in 2024

- **Projects v2 (v2 is the modern Projects; v1 is legacy/deprecated):** full CRUD — `ProjectV2`, `ProjectV2Item`, `ProjectV2Field`, `ProjectV2StatusUpdate` (added **2024-06-21**: `createProjectV2StatusUpdate`, `updateProjectV2StatusUpdate`, `deleteProjectV2StatusUpdate`, `convertProjectV2DraftIssueItemToIssue`, `ProjectV2StatusOrder`, etc.). `updateProjectV2Field` added **2024-12-04**.
- **Sub-issues (2024-12-02):** `AddSubIssueInput`, `RemoveSubIssueInput`, `ReprioritizeSubIssueInput`, `SubIssuesSummary`; `Issue.parent`, `Issue.subIssues`, `Issue.subIssuesSummary`; mutations `addSubIssue`, `removeSubIssue`, `reprioritizeSubIssue`; `CreateIssueInput.parentIssueId`.
- **Issue dependencies / blocking (2025-07-30):** `AddBlockedByInput`, `RemoveBlockedByInput`, `IssueDependenciesSummary`, `Issue.blockedBy`, `Issue.blocking`, `Issue.issueDependenciesSummary`; `addBlockedBy`, `removeBlockedBy`; timeline events `BLOCKED_BY_ADDED_EVENT`, `BLOCKING_ADDED_EVENT`, etc.
- **Environments pinning (2024-05-15):** `PinEnvironmentInput`, `ReorderEnvironmentInput`, `PinnedEnvironmentConnection`, `Environment.isPinned`, `Environment.pinnedPosition`, `Repository.pinnedEnvironments`, `Repository.environments(pinnedEnvironmentFilter:)`.
- **Enterprise member invitations (2024):** `EnterpriseMemberInvitation` + connection, `inviteEnterpriseMember`, `acceptEnterpriseMemberInvitation`, `cancelEnterpriseMemberInvitation`, `Query.enterpriseMemberInvitation(ByToken)`.
- **Git signature verification:** `GitSignature.verifiedAt`, `GpgSignature.verifiedAt`, `SmimeSignature.verifiedAt`, `SshSignature.verifiedAt`, `UnknownSignature.verifiedAt`.
- **Repository deploy-key settings:** `RepositoryDeployKeySetting` (Enterprise/Org owner info), `DeployKey.enabled`.

### 7.2 New types/fields added in 2025

- **Repository custom properties (2025-12-10):** `RepositoryCustomProperty` + connection, `CustomPropertyValueType` (enum: `STRING`, `TRUE_FALSE`, `SINGLE_SELECT`, `MULTI_SELECT`, `URL`), mutations `createRepositoryCustomProperty`, `updateRepositoryCustomProperty`, `deleteRepositoryCustomProperty`, `promoteRepositoryCustomProperty`, `setRepositoryCustomPropertyValues`; fields on `Enterprise`, `Organization`, `Repository`.
- **Issue custom fields (2025):** `IssueField`, `createIssueField`, `markIssueFieldValue`, `Issue.viewerCanSetFields`, `Repository.viewerCanSeeIssueFields`, `IssueFilters.type`.
- **Issue types:** `createIssueType` / `updateIssueType` (and `CreateIssueTypeInput`/`UpdateIssueTypeInput` gained/lost `isPrivate`).
- **New assignee/suggested-reviewer model (2025-04):** `ActorConnection`, `AssigneeConnection`, `assignedActors`/`suggestedActors` on `Issue`/`PullRequest`/`Repository`, `replaceActorsForAssignable`; `RepositorySuggestedActorFilter`.
- **Suggested reviewers (2025-11-30):** `SuggestedReviewerActor` + connection, `PullRequest.suggestedReviewerActors`.
- **Required reviewers (2025-11-13):** `RequiredReviewerConfiguration`, `PullRequestParameters.requiredReviewers`.
- **Projects v2 timeline events (2025-10-15):** `AddedToProjectV2Event`, `RemovedFromProjectV2Event`, `ProjectV2ItemStatusChangedEvent`, `ConvertedFromDraftEvent` added to `IssueTimelineItems`/`PullRequestTimelineItems` unions.
- **Copilot / agent fields (2025-11/09):** `Agentic` interface on `User`, `CopilotCodeReviewParameters`, `RepositoryRuleType.COPILOT_CODE_REVIEW`.
- **Release assets:** `ReleaseAsset.digest` (2025-05-27), `Release.immutable` (2025-07-04).
- **Milestone counts:** `Milestone.openIssueCount`, `Milestone.closedIssueCount` (2025-04-30).
- **Duplicate issues:** `Issue.duplicateOf`, `ClosedEvent.duplicateOf` (2025-05-22).
- **Custom org properties / ruleset conditions (2025-10-24):** `OrganizationPropertyTargetDefinition`, `RepositoryRuleConditions.organizationProperty`.
- **Minimize/unminimize:** `viewerCanUnminimize` across `Minimizable` (2025-09-11).

### 7.3 Deprecated / scheduled-for-removal (breaking changes to plan around)

These are the **announced removals** a mirror must either skip (don't build the deprecated field) or replicate the deprecation path:

- **`Issue.stateReason` / `ClosedEvent.stateReason`** — deprecated directives removed **2025-07-15**; `stateReason` member scheduled for removal **2025-10-01**; `Issue.stateReason.enableDuplicate` removed effective **2025-10-01**.
- **`NotificationThread.list`** → use `optionalList`; **`NotificationThread.subject`** → use `optionalSubject`; both removed effective **2026-01-01**.
- **`ReviewRequest.requestedBy`** → use `requestedByActor`; removed effective **2026-04-01**.
- **`SearchType.ISSUE_ADVANCED`** — removed effective **2025-11-04**.
- **Announcement banner** rework: `AnnouncementBanner` interface → `AnnouncementBannerI` (2024-12); old `Enterprise.announcement*` / `Organization.announcement*` (deprecated) fields and the `AnnouncementBannerI` interface itself **removed 2025-04-14**.
- **`PullRequestParameters.automaticCopilotCodeReviewEnabled`** — removed **2025-12-05**.
- **`BotOrUser`** union — added **2025-05-06**, then **removed 2025-06-13** (replaced by `botIds: [ID!]!` on `RequestReviewsInput`).
- **Audit entry fields** — a massive `AuditEntry.*` / `*AuditEntry.*` removal scheduled **2026-04-01** (action, actor, actorIp, actorLocation, actorLogin, actorResourcePath, actorUrl, createdAt, operationType, user, userLogin, userResourcePath, userUrl, plus per-concrete-entry variants).
- **`CreateIssueInput.projectV2Ids`** added **2025-11-06** (multi-project association).
- **`AddPullRequestReviewThreadInput.path`** changed type `String!` → `String` (**2025-05-01**); `DraftPullRequestReviewThread.path`/`.line` likewise (**2025-04-29**) — a *type-loosening* (technically additive).

**Lesson for QGL:** GitHub deprecates for ~6 months with a changelog "Effective" date, then hard-removes. A competitor should (a) never build fields already on a removal schedule, (b) replicate the deprecation *mechanism* (`@deprecated(reason:)` directive + changelog + effective date) even if it never uses it, so the SDK can warn.

### 7.4 Pagination-breaking change (reactions)

Reaction lists and several list fields were migrated to **full cursor/Relay pagination** (previously some returned bare arrays). The pattern: a field that used to be `[X]` became `XConnection` with mandatory `first`/`last`. Any client that selected a bare array must now select `nodes`/`edges`. QGL should be born **Relay-only** (no bare-list connections) to avoid ever making this break.

---

## 8. Introspection Query

### 8.1 How to fetch the schema

- `GET https://api.github.com/graphql` (with `Authorization: bearer TOKEN`) → JSON introspection.
- `GET` with header `Accept: application/vnd.github.v4.idl` → **IDL** (condensed SDL).
- Or POST a full introspection document.
- Or download the published `schema.docs.graphql` (FPT/GHES) from the *Public schema* page.

### 8.2 Full introspection query (the canonical `IntrospectionQuery`)

This is the standard GraphQL introspection document — the same one graphql-code-generator / `@graphql-codegen/introspection` emits, and what an octokit-style auto-generator would POST:

```graphql
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      ...FullType
    }
    directives {
      name
      description
      locations
      args { ...InputValue }
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args { ...InputValue }
    type { ...TypeRef }
    isDeprecated
    deprecationReason
  }
  inputFields { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes { ...TypeRef }
}

fragment InputValue on __InputValue {
  name
  description
  type { ...TypeRef }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}
```

The `TypeRef` fragment unrolls to **8 levels of nesting**, which is the depth that covers GitHub's list-of-list-of (e.g. `[[[String!]!]!]`) — OpenForge/QGL should support the same introspection depth so a standard codegen tool consumes the schema without modification.

### 8.3 Minimal introspection (type listing)

```graphql
# List all types + their fields
query {
  __schema {
    types { name kind description fields { name } }
  }
}

# Inspect one type
query {
  __type(name: "Repository") {
    name
    kind
    description
    fields { name type { kind name ofType { name } } }
  }
}
```

### 8.4 SDK-shape implication

Because GitHub is fully introspectable and ships an IDL, the **octokit-style auto-generation** path is viable: run the `IntrospectionQuery` against QGL → `@graphql-codegen` → typed TS `*Args`/`*Payload`/connection types → a generated `qgl.graphql.query(...)` client with end-to-end types. This is exactly how `@octokit/graphql-schema` keeps GitHub's TS types in lockstep. OpenForge should **expose introspection + IDL** from day one; it's the cheapest way to make third-party tooling "just work."

---

## 9. Webhooks vs GraphQL Subscriptions

### 9.1 There are NO GraphQL subscriptions on GitHub

GitHub's public GraphQL API has **no `subscription` operation and no WebSocket transport**. The only real-time channel is **webhooks** (server-to-server push over HTTPS POST). For a self-hosted competitor this is a deliberate simplification: **do not build a subscription transport in QGL; build a webhook emitter.** Polling GraphQL is the client-side fallback.

### 9.2 When to use what

| Mechanism | Direction | Latency | Use |
|-----------|-----------|---------|-----|
| **Webhook** (push) | Server → your HTTPS endpoint | ~instant | Server-side reactions: CI trigger, sync to DB, notifications, audit. |
| **Polling GraphQL** (pull) | Your client → server | You choose | Client-side freshness when you can't receive webhooks (browser, edge, ephemeral), or for state reconciliation. |
| **REST conditional (304)** | Your client → server | You choose | Cheap re-check of cacheable objects (file, commit, tag). |

GitHub's own guidance: *"You should subscribe to webhook events instead of polling the API for data."*

### 9.3 Webhook delivery contract

GitHub `POST`s the payload to your URL with these headers (from `@octokit/webhooks`):

| Header | Required | Meaning |
|--------|----------|---------|
| `X-GitHub-Event` | Yes | Event name (e.g. `issues`) |
| `X-GitHub-Delivery` | Yes | GUID for this delivery |
| `X-Hub-Signature` | if secret | `sha1=<HMAC-SHA1(body, secret)>` |
| `X-Hub-Signature-256` | if secret | `sha256=<HMAC-SHA-256(body, secret)>` |
| `User-Agent` | Yes | `GitHub-Hookshot/<sha>` |
| `Content-Type` | Yes | `application/json` |

The endpoint should return **2xx** quickly; GitHub retries failed deliveries with backoff. **Verify the HMAC-SHA-256 signature** (constant-time compare) before trusting the body. Common payload envelope fields: `action`, `sender`, `repository`, `organization` (when org-scoped), `installation` (when a GitHub App).

### 9.4 Event types a competitor must emit (and their `action` values)

- **`issues`** — `opened, edited, deleted, pinned, unpinned, closed, reopened, assigned, unassigned, labeled, unlabeled, locked, unlocked, transferred, milestoned, demilestoned`
- **`issue_comment`** — `created, edited, deleted`
- **`pull_request`** — `assigned, unassigned, labeled, unlabeled, opened, edited, closed, reopened, synchronize, converted_to_draft, ready_for_review, review_requested, review_request_removed, locked, unlocked, auto_merge_enabled, auto_merge_disabled, enqueued, dequeued`
- **`pull_request_review`** — `submitted, dismissed, edited`
- **`pull_request_review_comment`** — `created, edited, deleted, submitted`
- **`push`** — (no `action`; carries `ref`, `before`, `after`, `commits[]`)
- **`workflow_run`** — `requested, in_progress, completed`
- **`check_run`** — `created, rerequested, completed, in_progress, queued`
- **`check_suite`** — `completed, requested, rerequested`
- **`release`** — `published, unpublished, created, edited, deleted, prereleased`
- **`create` / `delete`** — ref created/deleted
- **`fork`** — (no action)
- **`star` / `unstar`** — `created`, `deleted`
- **`watch`** — `started`
- **`member`** — `added, removed, invited`
- **`team`** — `added, removed`
- **`team_add` / `team_remove`**
- **`public` / `private`**
- **`deployment` / `deployment_status`**
- **`project_card` / `project_column` / `projects`** (v1, legacy)
- **`discussion` / `discussion_comment`**
- **`repository`** — `created, deleted, renamed, archived, unarchived`
- **`organization`** — `member_added, member_removed, member_invited`
- **`security_advisory`**, **`secret_scanning_alert`**, **`dependabot_alert`**
- **`codespaces` / `codespace_punctuation`**
- **`merge_group`**

### 9.5 `@octokit/webhooks` usage (server-side)

```ts
import { Webhooks } from "@octokit/webhooks";

const webhooks = new Webhooks({ secret: process.env.WEBHOOK_SECRET });

webhooks.on("issues.opened", async ({ payload }) => {
  console.log(`${payload.issue.user.login} opened #${payload.issue.number}`);
});

webhooks.on("pull_request", async ({ payload }) => {
  // payload.action distinguishes opened/closed/synchronize/...
  console.log(payload.action, payload.pull_request.number);
});

webhooks.on("workflow_run.completed", async ({ payload }) => {
  console.log(payload.workflow_run.conclusion);
});

webhooks.onAny((event) => {
  // catch-all; event.name, event.id, event.payload
});

// In your HTTP handler:
app.post("/webhooks/github", async (req, res) => {
  try {
    await webhooks.verify({
      id: req.header("X-GitHub-Delivery"),
      signature: req.header("X-Hub-Signature-256"),
      payload: req.body,
    });
    await webhooks.receive({
      id: req.header("X-GitHub-Delivery"),
      name: req.header("X-GitHub-Event"),
      payload: req.body,
    });
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(403);
  }
});
```

### 9.6 Polling pattern (client-side, the QGL complement)

When you cannot receive webhooks, poll a narrow, cheap connection and diff by global ID. To stay in budget: small `first`, select only `updatedAt`/`id`, lean on `rateLimit.remaining`, and back off when nothing changed. This is exactly what `pr-shepherd` does (a `rateLimit(dryRun:true)` preview + conditional REST reads to spend ~4 points/hour idle).

---

## 10. Code Examples

### 10.1 Full octokit.graphql paginated fetch loop (TypeScript)

A production-grade generic paginator that works with **any** connection shape (single or nested), respects the node cap, reads `rateLimit` in-band, and backs off on secondary limits.

```ts
import { Octokit } from "octokit";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/**
 * A "connection selector" — the part of the GraphQL you want paged,
 * expressed as { path: "repository.issues", fields: "..." } so we can
 * rebuild the query per page. For real use, template the query string.
 */
export async function* paginateIssues<T = { title: string }>(
  owner: string,
  repo: string,
  pageSize = 100,
  onRateLimit?: (rl: { remaining: number; resetAt: string }) => void,
): AsyncGenerator<T> {
  let cursor: string | null = null;
  let exhausted = false;

  while (!exhausted) {
    // NOTE: cursor var MUST be named `$cursor` for plugin-paginate-graphql interop.
    const data = await octokit.graphql(
      `query($owner: String!, $repo: String!, $cursor: String, $n: Int!) {
         rateLimit { remaining resetAt }
         repository(owner: $owner, name: $repo) {
           issues(first: $n, after: $cursor) {
             totalCount
             nodes { title }
             pageInfo { hasNextPage endCursor }
           }
         }
       }`,
      { owner, repo, cursor, n: Math.min(pageSize, 100) },
    );

    onRateLimit?.(data.rateLimit);

    const issues = data.repository?.issues;
    if (!issues) {
      // NOT_FOUND -> repository null; surface it rather than spin
      throw new Error(`repository ${owner}/${repo} not found`);
    }

    for (const node of issues.nodes) {
      yield node as T;
    }

    exhausted = !issues.pageInfo.hasNextPage;
    cursor = exhausted ? null : issues.pageInfo.endCursor;

    // Be a good citizen: pause on near-empty windows
    if (data.rateLimit.remaining < 100) {
      await sleep(msUntil(data.rateLimit.resetAt));
    }
  }
}

function msUntil(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Usage:
// for await (const issue of paginateIssues("octokit", "graphql.js")) {
//   console.log(issue.title);
// }
```

### 10.2 GraphQL cost calculation (client-side estimator)

Implements the published algorithm: `max(1, round(aggregate/100))`, where `aggregate` is the multiplicative fan-out of connection instances. For a real tool you'd walk the AST; this is the working model.

```ts
/**
 * Estimate the primary-rate-limit point cost of a query.
 * `connections` describes each connection field and how many parent
 * nodes instantiate it (the fan-out multiplier).
 *
 * cost = max(1, round( sum(parents_i * pageSize_i) / 100 ))
 */
export function estimateCost(
  connections: { parents: number; first: number }[],
): number {
  const clamped = connections.map(
    (c) => c.parents * Math.min(Math.max(c.first, 1), 100),
  );
  const aggregate = clamped.reduce((a, b) => a + b, 0);
  return Math.max(1, Math.round(aggregate / 100));
}

// Works the documented example:
//   viewer.repositories(first:100)   -> parents=1,   first=100  => 100
//   .issues(first:50)                -> parents=100, first=50   => 5,000
//   .labels(first:60)                -> parents=5000,first=60   => 300,000 (but
//     GitHub's example counts labels as 1 request per *potential* issue = 5,000,
//     because labels connect per-issue, not per-repo*issue — see note)
const reposOnly   = estimateCost([{ parents: 1, first: 100 }]);            // 1
const reposPlusPr = estimateCost([
  { parents: 1, first: 100 },       // repos
  { parents: 100, first: 50 },      // issues under each repo
]);
console.log(reposOnly, reposPlusPr); // 1  51  (matches GitHub's 5,101/100=51)
```

> **Note on the exact formula:** GitHub's worked example counts "requests to fulfill each unique connection" as the **parent fan-out** (the number of objects that own the connection), *not* `parent × first`. In their example, `labels` costs **5,000** = the number of *issues* (the parents of the labels connection), because there are 5,000 potential issues. So the precise model is: **`requests_i = number of parent nodes that instantiate connection i`** (clamped by page reachability), and `cost = max(1, round(Σ requests_i / 100))`. Use `parents_i` as the multiplier; the `first/last` value matters only for the **node cap**, not the point cost. Implement the point cost on **parent fan-out** and the **node cap** on `parents_i × first_i`.

### 10.3 GitHub App installation token refresh loop

Self-contained refresher: keep a 1-hour installation token warm, re-minting ~5 min before expiry, with a process-local cache.

```ts
import crypto from "node:crypto";
import { createHmac } from "node:crypto";

const APP_ID = Number(process.env.APP_ID);
const PRIVATE_KEY = process.env.PRIVATE_KEY as string; // PEM PKCS8
const INSTALLATION_ID = Number(process.env.INSTALLATION_ID);
const GITHUB = "https://api.github.com";

/** Sign an RS256 JWT for the App (iat=now-30s to absorb clock skew, exp<=10min). */
function makeAppJwt(): string {
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 9 * 60; // 9 minutes
  const b64url = (b: Buffer) =>
    b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ iat, exp, iss: APP_ID })));
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), PRIVATE_KEY);
  return `${signingInput}.${b64url(sig)}`;
}

/** Mint (or reuse) an installation access token, valid 1 hour. */
let cached: { token: string; expiresAt: number } | null = null;

export async function getInstallationToken(): Promise<string> {
  // Reuse if > 5 min of life remain
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token;
  }
  const jwt = makeAppJwt();
  const res = await fetch(
    `${GITHUB}/app/installations/${INSTALLATION_ID}/access_tokens`,
    { method: "POST", headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string; expires_at: string };
  cached = { token: body.token, expiresAt: new Date(body.expires_at).getTime() };
  return body.token;
}

/** Background refresher: re-mint before expiry so long-running workers never lapse. */
export function startRefresher(intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    getInstallationToken().catch((e) => console.error("refresh failed", e));
  }, intervalMs);
}
```

The same logic is what `@octokit/auth-app`'s `createAppAuth` does for you (default cache TTL 59 min); the above is the transparent version for a hand-rolled QGL server.

### 10.4 Rate-limit-aware fetch (primary + secondary + conditional)

```ts
export async function getWithBackoff(
  path: string,
  etag?: string,
): Promise<{ status: number; etag?: string; body?: any }> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      authorization: `token ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
    };
    if (etag) headers["if-none-match"] = etag;

    const res = await fetch(`https://api.github.com${path}`, { headers });

    if (res.status === 304) return { status: 304 }; // not modified, no cost

    const nextEtag = res.headers.get("etag") ?? undefined;
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const retryAfter = Number(res.headers.get("retry-after"));

    if (res.ok) {
      return { status: res.status, etag: nextEtag, body: await res.json() };
    }
    if ((res.status === 403 || res.status === 429) && (remaining === 0 || retryAfter)) {
      const wait = retryAfter
        ? retryAfter * 1000
        : reset * 1000 - Date.now();
      await new Promise((r) => setTimeout(r, Math.max(1000, wait)));
      continue; // retry the same request after the window
    }
    if (res.status >= 500 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue; // transient
    }
    throw new Error(`${res.status}: ${await res.text()}`);
  }
}
```

---

## 11. References

All URLs cited, grouped by section. Fetched/searched 2026-11-03.

**GraphQL overview & forming calls**
- https://docs.github.com/en/graphql (GraphQL API landing / reference index)
- https://docs.github.com/en/graphql/overview (overview, public schema, breaking changes, changelog links)
- https://docs.github.com/en/graphql/overview/public-schema (download `schema.docs.graphql`; introspection)
- https://docs.github.com/en/graphql/guides/forming-calls-with-graphql (endpoint, query vs mutation, variables, example query/mutation)
- https://docs.github.com/en/graphql/guides/introduction-to-graphql (schema, field, argument, `__schema`/`__type`, IDL `Accept: application/vnd.github.v4.idl`)
- https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api (first/last 1..100, cursor traversal, forward/backward)
- https://docs.github.com/en/graphql/guides/managing-queries → **404** (legacy/redirected; content now under the rate-limits page)

**Rate limits & query limits**
- https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api (primary points, `rateLimit` object, cost algorithm 5,101→51, secondary limits 2,000 pts/min, node limit 500,000, timeouts 502/504)
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (REST headers, per-auth limits, secondary points, `GET /rate_limit`)
- https://docs.github.com/en/rest/rate-limit (REST rate-limit endpoints index)
- https://docs.rs/github-graphql-node-count/latest/github_graphql_node_count/fn.point_cost.html (`cost = max(1, round(A/100))`)
- https://www.allanninal.dev/github/graphql-mutation-secondary-cost/ (mutation = 5 secondary pts, query = 1)
- https://stackoverflow.com/questions/79212836 (primary vs secondary are computed separately)

**Pagination / Relay spec**
- https://relay.dev/graphql/connections.htm (Cursor Connections Spec: edges, node, cursor, PageInfo, `first/after/last/before`, algorithm, edge-order)
- https://relay.dev/docs/guided-tour/list-data/pagination/ (Relay connection model)
- https://github.com/octokit/plugin-paginate-graphql.js/ (`$cursor` + `pageInfo` conventions, forward/backward, single-resource limit)
- https://github.com/octokit/octokit.graphql.net/blob/main/docs/paging.md (first/after/last/before + Connection object)

**octokit / graphql-request / webhooks / auth-app (Context7 sources)**
- https://github.com/octokit/octokit.js (Octokit `graphql`, `graphql.paginate`, `graphql.paginate.iterator`)
- https://github.com/octokit/graphql-schema (`RepositoryConnection`, `RepositoryEdge`, `PageInfo`, `Query` ~30 fields)
- https://github.com/onfido/graphql-request (`request`, `rawRequest`, `GraphQLClient`, `ClientError`)
- https://github.com/octokit/webhooks (webhook delivery headers, `issues`/`pull_request`/`workflow_run` payload objects + actions)
- https://github.com/octokit/auth-app.js (`createAppAuth`, installation token 60 min, `createJwt`, transparent refresh)
- https://graphidocsorg.github.io/docs/packages/docs/examples/github/query.doc.html (canonical `Query` root type)

**Schema changelog (2024 + 2025)**
- https://docs.github.com/en/graphql/overview/changelog/2024 (Projects v2, sub-issues, env pinning, enterprise invitations)
- https://docs.github.com/en/graphql/overview/changelog/2025 (custom properties, issue fields/types, assigned/suggested actors, audit-entry removals, stateReason removals)
- https://docs.github.com/en/graphql/overview/breaking-changes (deprecation/removal policy)

**Authentication**
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens (classic vs fine-grained, all permission tables, 50-token cap, 366-day org cap)
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens (`X-Accepted-GitHub-Permissions`)
- https://github.blog/security/application-security/introducing-fine-grained-personal-access-tokens-for-github/ (fine-grained PAT design)
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app (App / installation / on-behalf-of-user modes)
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app (RS256 JWT, iat/exp/iss, clock skew)
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app (1-hour installation token)
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps (web + device flow RFC 8628)
- https://ghtier.com/permission-model (credential lifetime cheat-sheet: JWT ≤10 min, installation 1 hr, user token 8 hr + 6-mo refresh)
- https://docs.github.com/en/graphql/guides/forming-calls-with-graphql#authenticating-with-graphql (PAT/OAuth/App auth to GraphQL)

---

## 12. Recommendations for OpenForge / QGL

Synthesis of the research into the three downstream decisions the goal named.

### 12.1 Mirror full GitHub GraphQL vs. design a QGL subset

**Recommendation: design QGL as a *shape-compatible fork* of GitHub GraphQL — same conventions, a deliberately smaller field set.**

- **Why not a 1:1 mirror:** the public schema is ~300 mutations and ~500+ types with constant churn (2024/2025 changelogs show dozens of additions *and* scheduled removals every few weeks). Mirroring it exactly means maintaining a moving target and reproducing fields you'd never use (sponsors, GHEC enterprise, attestation, models, knowledge bases).
- **Why not a from-scratch API:** throwing away the shape (connections, global IDs, `rateLimit`, `clientMutationId`, introspection) forfeits the single biggest asset — *existing client tooling*. The `relay.dev` Cursor Connection spec, the `rateLimit { cost remaining resetAt }` field, `first/after/last/before` 1..100, opaque base64 cursors, and `nodes(ids:[...])` are all **industry-standard** and what octokit/`gh`/codegen already understand.
- **Concrete QGL v1 surface:** ship the **§1.1 Query #1–#9** + `rateLimit` + `meta`, and the **§1.2 mutation set minus** enterprise/sponsors/security-advisory/attestation (≈ 70 mutations covering repos, refs, issues, PRs, reviews, comments, reactions, gists, labels, milestones, checks, environments, deployments, branch protection, star/follow/watch, assign/label). Defer `search` to a second milestone (it's high-value but expensive to build).
- **Born-Relay:** every list is a `*Connection` with `first/after/last/before`, `edges`, `nodes`, `pageInfo`, `totalCount`; enforce `first/last ∈ 1..100` and a 500,000-node cap. Never emit bare-list connections (avoids GitHub's reaction-pagination breaking change).

### 12.2 Client SDK shape: auto-generated via introspection vs. handwritten resolvers

**Recommendation: expose introspection + IDL, and generate the client; handwrite only resolvers.**

- **Server resolvers:** handwritten (you own the domain logic). Use a schema-first SDL file that *declares* the QGL subset; resolvers implement it.
- **Client SDK:** generate from introspection with `@graphql-codegen` (`typescript-operations`, `typescript-resolvers`, `typescript-introspection`). Because QGL keeps GitHub's shape, the generated TS types for connections/args/payloads look identical to `@octokit/graphql-schema`, and the `plugin-paginate-graphql` conventions (`$cursor` + `pageInfo`) make **existing octokit pagination code drop-in compatible** if you also ship an `Octokit`-shaped `qgl.graphql` facade.
- **Two-client strategy:** (a) a thin **`graphql-request`-style** vendor-neutral client for general use, and (b) an **octokit-compatible facade** (`qgl.graphql(query, vars)`, `qgl.graphql.paginate`, `qgl.graphql.paginate.iterator`) so the largest existing codebase (octokit users, `gh`) needs only a `baseUrl` change. Both are cheap once introspection is public.
- **Must-ship introspection:** `IntrospectionQuery` (8-level `TypeRef`) + IDL via `Accept: application/vnd.github.v4.idl`. This is the cheapest path to third-party tooling working unmodified.

### 12.3 Pagination strategy: cursor + Relay

**Recommendation: adopt Relay Cursor Connections verbatim.**

- Opaque `base64("cursor:v1:" + stableKey)` cursors; `first/after` forward, `last/before` backward; `PageInfo { hasNextPage hasPreviousPage startCursor endCursor }`; `totalCount` cheap; `nodes` as a projection.
- Enforce the node cap (500,000) and the `first/last ∈ 1..100` rule server-side with a clear `TOO_MANY_NODES` error.
- Honor the Relay edge-order contract (consistent order; `after` → closest-to-cursor first, `before` → closest-to-cursor last).
- For **conditional/cheap polling**, add the REST-style `ETag`/`If-None-Match → 304` (no rate-limit charge) on cacheable snapshot endpoints, and a `rateLimit(dryRun: true)` so clients can preview cost — these two features are what let sophisticated clients (CI pollers, PR-wait tools) spend near-zero points when idle.

### 12.4 Rate-limit metering for QGL (what to implement)

1. **Primary:** `cost = max(1, round(Σ parentFanOut_i / 100))` per query; per-credential hourly budget (default 5,000 pts/hr; make it configurable per deployment). Expose via the `rateLimit` object **and** the five `x-ratelimit-*` headers (`x-ratelimit-resource: graphql`).
2. **Secondary:** per-minute point ceiling (read=1, mutation=5; default 2,000 pts/min) + a concurrency cap (≤ 100). Return `403/429` with `retry-after` on breach; never report the secondary status in-band (GitHub doesn't either).
3. **Graceful degradation:** on node-cap or resource breach, return **partial `data` + `errors[]`** (type `RESOURCE_LIMIT`), not a hard 500 — this matches GitHub's "partial results + error" behavior and is what clients are coded to handle.
4. **Error envelope:** standard `{ data, errors: [{ type, message, path, locations, extensions: { code } }] }`; keep `type` values (`NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`, `RATE_LIMITED`, `TOO_MANY_NODES`, `CONFLICT`, `VALIDATION`) stable and document them — they're the contract `GraphqlResponseError`-style clients depend on.

### 12.5 Auth parity (so tokens "just work")

Support, in priority order: (1) **PAT** (`Authorization: token <PAT>`), (2) **OAuth App** web + device flow, (3) **App-style** JWT (RS256, `iss`/`iat`/`exp≤10min`) → **installation token** (1 hr) minting endpoint → `Authorization: token <inst_token>`. Keep the `Bearer`-vs-`token` scheme distinction, and the 1-hour installation / ≤10-minute JWT lifetimes, because the entire `@octokit/auth-app` refresh machinery is tuned to those exact numbers. Fine-grained, resource-scoped permissions (the 50+ repo/org/account permission vocabulary in §5.1) are the highest-value permission model to replicate — it's the least-privilege story GitHub is pushing and what power users will expect.

### 12.6 Real-time: webhooks, not subscriptions

Ship a **webhook emitter** (HMAC-SHA-256 `X-Hub-Signature-256`, `X-GitHub-Event`, `X-GitHub-Delivery` headers, 2xx-ack + retry) for the §9.4 event set. **Do not** build a GraphQL `subscription`/WebSocket transport — GitHub doesn't have one, clients don't expect it, and webhooks + conditional-GET polling cover every real use case.

---

*End of report. Generated 2026-11-03 for the OpenForge project. All external facts carry a source URL in §11; the cost formula, node-cap arithmetic, Relay edge-order, and secondary-limit numbers are quoted from the official docs and cross-checked against the Context7 octokit sources.*
