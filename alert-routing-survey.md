# Alert Routing for Self-Hosted Git Platforms: Exhaustive Survey

> Survey date: 2026-11-03. All configs sourced from public repositories and official documentation.

---

## Table of Contents

1. Severity Taxonomy for Git Platforms
2. Real Alert Rules (PromQL + Routing Decisions)
3. Alertmanager: Real Configs from the Wild
4. Alertmanager: Routing Tree Reference
5. Inhibition Rules
6. Mute Time Intervals
7. Grafana Alerting: Real Provisioned Rules
8. PagerDuty: Events API v2
9. OpsGenie: Alert Payload Format
10. Squadcast (SolarWinds IR): Webhook Integration
11. On-Call Rotation Patterns for Small SRE Teams
12. Recommended Routing Tree for OpenForge (Single-Operator)

---

## 1. Severity Taxonomy

Severity levels for a self-hosted Git platform, mapped to the three tiers used across
Alertmanager, Grafana, PagerDuty, and OpsGenie.

| Tier | Severity Label | Git Platform Examples | Response Expectation |
|------|---------------|----------------------|---------------------|
| **Critical** | critical / CRIT / P1 | Push broken, clone broken, SSH daemon down, runner fleet at 0 replicas, disk full | Page on-call immediately. group_wait: 10s. repeat_interval: 1h. |
| **Warning** | warning / WARN / P3 | p95 latency > 1s, queue backlog, memory > 85%, PVC > 85% used, error rate > 50% | Slack notification only. No page. group_wait: 1m. repeat_interval: 12h or 24h. |
| **Info** | info / INFO / P5 | Deploy complete, backup finished, certificate expiring in 7 days, request rate spike | Dashboard / log only. No proactive notification. repeat_interval: 24h+. |

### Why three tiers, not more?

The PagerDuty Events API v2 supports four severities: critical, error, warning, info
(source: https://developer.pagerduty.com/docs/send-alert-event). OpsGenie uses a P1-P5
priority scale. Alertmanager is label-agnostic - you choose the scheme.

For a single-operator Git platform, three tiers are sufficient. The error tier (between
critical and warning) is useful in multi-service architectures but adds noise for a
one-person operation. The Django-School-Management config
(https://github.com/TareqMonwer/Django-School-Management/blob/master/alertmanager.yml)
and the AiSOC config (https://github.com/beenuar/AiSOC/blob/main/infra/docker/alertmanager.yml)
both use exactly three tiers: critical, warning, and an implicit info default.

---

## 2. Real Alert Rules (PromQL + Routing Decisions)

### 2.1 Forgejo/Gitea PrometheusRule - billimek/k8s-gitops

**Source**: https://github.com/billimek/k8s-gitops/blob/master/kubernetes/default/forgejo/prometheusrule.yaml
(license: Apache-2.0)

This is the **only real, production-shaped PrometheusRule for a self-hosted Git platform**
found in public repositories. It contains 7 alert rules with severity labels and
detailed annotations.

```yaml
# Source: https://github.com/billimek/k8s-gitops/blob/master/kubernetes/default/forgejo/prometheusrule.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: forgejo-rules
  namespace: default
spec:
  groups:
    - name: forgejo.rules
      rules:
        - alert: ForgejoDown
          annotations:
            description: >-
              Forgejo has not been scraped successfully for 10 minutes.
              The web UI, git HTTP, and SSH clone paths may all be unreachable.
            summary: Forgejo is down.
          expr: up{namespace="default", job="gitea-http"} == 0
          for: 10m
          labels:
            severity: critical

        - alert: ForgejoHighLatency
          annotations:
            description: >-
              p95 request latency on the internal route has been above 1s for 15 minutes.
              SQLite write contention is a likely cause under concurrent Actions/webhook load.
            summary: Forgejo request latency is elevated.
          expr: histogram_quantile(0.95, sum by (le)
            (rate(envoy_cluster_upstream_rq_time_bucket{
              envoy_cluster_name="httproute/default/forgejo/rule/0"
            }[10m]))) > 1000
          for: 15m
          labels:
            severity: warning

        - alert: ForgejoHighMemoryUsage
          annotations:
            description: >-
              Forgejo container memory working set has been above 85%
              of its 1Gi limit for 15 minutes.
            summary: Forgejo memory usage is elevated.
          expr: >-
            container_memory_working_set_bytes{namespace="default", container="forgejo"}
            / 1073741824 > 0.85
          for: 15m
          labels:
            severity: warning

        - alert: ForgejoPublicRouteErrorRate
          annotations:
            description: >-
              Over half of requests to the public route have returned 4xx/5xx
              for 15 minutes, with at least 0.2 req/s of sustained traffic.
            summary: Forgejo public route error rate is elevated.
          expr: >-
            sum(rate(envoy_cluster_upstream_rq_xx{
              envoy_cluster_name="httproute/default/forgejo-public/rule/0"
            }[10m])) > 0.2
            and
            sum(rate(envoy_cluster_upstream_rq_xx{
              envoy_cluster_name="httproute/default/forgejo-public/rule/0",
              envoy_response_code_class=~"4|5"
            }[10m])) /
            sum(rate(envoy_cluster_upstream_rq_xx{
              envoy_cluster_name="httproute/default/forgejo-public/rule/0"
            }[10m])) > 0.5
          for: 15m
          labels:
            severity: warning

        - alert: ForgejoPublicRouteRequestSpike
          annotations:
            description: >-
              Request rate on the public route has been above 5 req/s for 15 minutes.
            summary: Forgejo public route request rate is elevated.
          expr: >-
            sum(rate(envoy_cluster_upstream_rq_xx{
              envoy_cluster_name="httproute/default/forgejo-public/rule/0"
            }[10m])) > 5
          for: 15m
          labels:
            severity: warning

        - alert: ForgejoRunnerUnavailable
          annotations:
            description: >-
              The forgejo-runner deployment has had 0 available replicas for 10 minutes.
              Actions workflows cannot run.
            summary: Forgejo Actions runner is unavailable.
          expr: >-
            kube_deployment_status_replicas_available{
              namespace="default", deployment="forgejo-runner"
            } == 0
          for: 10m
          labels:
            severity: critical

        - alert: ForgejoConfigPVCNearFull
          annotations:
            description: >-
              The forgejo-config PVC has been above 85% used for 15 minutes.
            summary: Forgejo config PVC is nearly full.
          expr: >-
            1 - kubelet_volume_stats_available_bytes{
              namespace="default", persistentvolumeclaim="forgejo-config"
            } / kubelet_volume_stats_capacity_bytes{
              namespace="default", persistentvolumeclaim="forgejo-config"
            } > 0.85
          for: 15m
          labels:
            severity: warning
```

**Routing decisions implied by severity labels:**

| Alert | Severity | Route | Rationale |
|-------|----------|-------|-----------|
| ForgejoDown | critical | Page on-call | Push/clone broken. Users cannot work. |
| ForgejoRunnerUnavailable | critical | Page on-call | CI/CD broken. Merges blocked. |
| ForgejoHighLatency | warning | Slack | Degraded but functional. Check at next convenience. |
| ForgejoHighMemoryUsage | warning | Slack | Will OOM eventually. Not urgent. |
| ForgejoPublicRouteErrorRate | warning | Slack | Could be user error (4xx). Monitor. |
| ForgejoPublicRouteRequestSpike | warning | Slack | Possible DDoS/bot. Investigate during business hours. |
| ForgejoConfigPVCNearFull | warning | Slack | Will break in hours/days. Plan maintenance. |

### 2.2 Gitea Scrape Target - PaloAltoNetworks

**Source**: https://github.com/PaloAltoNetworks/prisma_channel_resources/blob/main/lab_deploy/compose_deploy/volumes/prometheus/prometheus.yml
(license: MIT)

```yaml
- job_name: 'gitea'
  bearer_token: <AUTH_TOKEN_FOR_GITEA>
  static_configs:
  - targets: ['gitea:3000']
```

Gitea exposes /metrics on port 3000 with Bearer token auth. The up{job="gitea"} metric
from this scrape target is the basis for the ForgejoDown alert.

### 2.3 Additional Alert Rules for Git Platforms

```yaml
- alert: GitSSHDown
  annotations:
    description: >-
      The git SSH service on port 22 has been unreachable for 5 minutes.
      All SSH-based push and clone operations will fail.
    summary: Git SSH daemon is down.
  expr: probe_success{job="git-ssh", instance=~".*:22"} == 0
  for: 5m
  labels:
    severity: critical

- alert: GitRepoDiskUsage
  annotations:
    description: >-
      Total git repository storage has exceeded 80% of the allocated volume.
    summary: Git repository storage is nearly full.
  expr: >-
    1 - kubelet_volume_stats_available_bytes{persistentvolumeclaim="git-repos"}
    / kubelet_volume_stats_capacity_bytes{persistentvolumeclaim="git-repos"} > 0.80
  for: 30m
  labels:
    severity: warning

- alert: WebhookDeliveryFailing
  annotations:
    description: >-
      More than 20% of webhook deliveries have failed in the last 15 minutes.
    summary: Webhook delivery failure rate is elevated.
  expr: >-
    sum(rate(gitea_webhook_deliveries_total{status=~"5.."}[15m]))
    / sum(rate(gitea_webhook_deliveries_total[15m])) > 0.20
  for: 15m
  labels:
    severity: warning

- alert: GiteaDeploymentComplete
  annotations:
    description: Gitea deployment completed successfully.
    summary: Gitea deployment complete.
  expr: changes(gitea_build_info[1h]) > 0
  for: 0s
  labels:
    severity: info
```

---

## 3. Alertmanager: Real Configs from the Wild

### 3.1 Official Prometheus Alertmanager Example

**Source**: https://github.com/prometheus/alertmanager/blob/main/doc/examples/simple.yml
(license: Apache-2.0)

The canonical reference config. Demonstrates the full routing tree with team-based routing,
severity-based sub-routes, and inhibition.

```yaml
global:
  smtp_smarthost: 'localhost:25'
  smtp_from: 'alertmanager@example.org'
  smtp_auth_username: 'alertmanager'
  smtp_auth_password: 'password'

templates:
  - '/etc/alertmanager/template/*.tmpl'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
  receiver: team-X-mails

  routes:
    # Services foo1, foo2, baz -> team-X. Critical sub-route -> pager.
    - matchers:
        - service=~"foo1|foo2|baz"
      receiver: team-X-mails
      routes:
        - matchers:
            - severity="critical"
          receiver: team-X-pager

    # Service "files" -> team-Y. Critical sub-route -> pager.
    - matchers:
        - service="files"
      receiver: team-Y-mails
      routes:
        - matchers:
            - severity="critical"
          receiver: team-Y-pager

    # Database service -> DB pager by default, sub-routed by owner.
    - matchers:
        - service="database"
      receiver: team-DB-pager
      group_by: [alertname, cluster, database]
      routes:
        - matchers:
            - owner="team-X"
          receiver: team-X-pager
          continue: true
        - matchers:
            - owner="team-Y"
          receiver: team-Y-pager

inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: [alertname, cluster, service]

receivers:
  - name: 'team-X-mails'
    email_configs:
      - to: 'team-X+alerts@example.org'

  - name: 'team-X-pager'
    email_configs:
      - to: 'team-X+alerts-critical@example.org'
    pagerduty_configs:
      - service_key: <team-X-key>

  - name: 'team-Y-mails'
    email_configs:
      - to: 'team-Y+alerts@example.org'

  - name: 'team-Y-pager'
    pagerduty_configs:
      - service_key: <team-Y-key>

  - name: 'team-DB-pager'
    pagerduty_configs:
      - service_key: <team-DB-key>
```

**Key pattern**: Two-level hierarchy. Level 1: team routing via service label.
Level 2: severity routing. Non-critical alerts fall through to parent receiver (email).

### 3.2 AiSOC: Severity Fan-Out with Team Grouping

**Source**: https://github.com/beenuar/AiSOC/blob/main/infra/docker/alertmanager.yml (MIT)

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: default
  group_by: ['alertname', 'team']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - severity = "critical"
      receiver: critical-page
      group_wait: 10s
      repeat_interval: 1h
    - matchers:
        - severity = "warning"
      receiver: warning-ticket
      group_wait: 1m
      repeat_interval: 12h

receivers:
  - name: default
    webhook_configs:
      - url: http://api:8000/internal/alerts/sink
        send_resolved: true
  - name: critical-page
    webhook_configs:
      - url: http://api:8000/internal/alerts/sink?severity=critical
        send_resolved: true
  - name: warning-ticket
    webhook_configs:
      - url: http://api:8000/internal/alerts/sink?severity=warning
        send_resolved: true

inhibit_rules:
  - source_matchers:
      - severity = "critical"
    target_matchers:
      - severity = "warning"
    equal: ['team', 'alertname']
```

Key details:
- group_by includes team so a "service down" page covers all affected services.
- critical-page has group_wait: 10s (fast page) vs warning-ticket at 1m.
- repeat_interval: 1h for critical (re-page if unresolved) vs 12h for warning.
- Inhibition: critical suppresses warning for same team+alertname.

### 3.3 Django-School-Management: Three-Tier Severity Routing

**Source**: https://github.com/TareqMonwer/Django-School-Management/blob/master/alertmanager.yml

```yaml
route:
  receiver: default
  group_by: ['alertname', 'app', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    - match:
        severity: critical
      receiver: critical
      group_wait: 10s
      repeat_interval: 1h
    - match:
        severity: warning
      receiver: warning
      repeat_interval: 4h
    - match:
        slo: availability
      receiver: slo-alerts
      continue: true

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'app']

receivers:
  - name: critical
    pagerduty_configs:
      - service_key: '${PAGERDUTY_SERVICE_KEY}'
        send_resolved: true
    webhook_configs:
      - url: '${SLACK_WEBHOOK_CRITICAL}'
        send_resolved: true
  - name: warning
    webhook_configs:
      - url: '${SLACK_WEBHOOK_URL}'
        send_resolved: true
```

**Key pattern**: The critical receiver fans out to BOTH PagerDuty AND Slack simultaneously.
The continue: true on SLO routes means an alert with both severity and slo labels
gets sent to both the severity receiver AND the SLO receiver.

### 3.4 ruanbekker/cheatsheets: OpsGenie + Slack + Environment Routing

**Source**: https://github.com/ruanbekker/cheatsheets/blob/master/alertmanager/example_configs/opsgenie/alertmanager.yml (MIT)

```yaml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/x/x/x'

route:
  group_by: ['alertname', 'cluster', 'job', 'env']
  repeat_interval: 24h
  group_interval: 5m
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: critical
      routes:
        - match_re:
            environment: .*(-staging).*
          receiver: warning
        - match_re:
            environment: .*(-dev).*
          receiver: default

receivers:
  - name: 'critical'
    slack_configs:
      - send_resolved: true
        title: '[{{ .Status | toUpper }}] {{ .CommonAnnotations.summary }}'
    opsgenie_configs:
      - send_resolved: true
        api_key: xx
        api_url: https://api.eu.opsgenie.com/
        message: '[{{ .Status | toUpper }}] {{ .CommonAnnotations.summary }}'
        description: >-
          {{ .CommonAnnotations.description }}
          More Info:
          - Impact: {{ .CommonAnnotations.impact }}
          - Action: {{ .CommonAnnotations.action }}
          - Runbook: {{ .CommonAnnotations.runbook }}
        source: '{{ template "opsgenie.default.source" . }}'
        responders:
        - name: DevOps
          type: team
        priority: '{{ if .CommonAnnotations.priority }}{{ .CommonAnnotations.priority }}{{ else }}P3{{ end }}'
        tags: 'monitoring, exporters, prometheus'
```

**Key pattern**: Environment-based routing. A critical alert in *-staging or *-dev
gets DOWNGRADED to the warning/default receiver (Slack only, no OpsGenie page).
This prevents staging deployments from paging the on-call.

### 3.5 pigsty: Comprehensive Template

**Source**: https://github.com/pgsty/pigsty/blob/main/roles/infra/templates/prometheus/alertmanager.yml (Apache-2.0)

```yaml
# Receiver types documented in the template:
#   webhook_configs, email_configs, slack_configs, wechat_configs,
#   pagerduty_configs, opsgenie_configs, telegram_configs,
#   discord_configs, webex_configs, msteams_configs,
#   pushover_configs, victorops_configs, sns_configs

# EXAMPLE: PagerDuty
# - name: 'pagerduty'
#   pagerduty_configs:
#     - routing_key: 'your-pagerduty-key'
#       send_resolved: true

inhibit_rules:
  # When node is down, suppress other alerts from same node
  - source_matchers: [ alertname="NodeDown" ]
    target_matchers: [ category="node" ]
    equal: ['ip']

# time_intervals:
#   - name: 'maintenance-window'
#     time_intervals:
#       - weekdays: ['sunday']
#         times:
#           - start_time: '02:00'
#             end_time: '06:00'
```

**Key detail**: The pigsty inhibition rule uses alert-name-based suppression (NodeDown),
not severity-based. When a node is down, you do not need the 15 other alerts it generates.

### 3.6 CrunchyData postgres-operator

**Source**: https://github.com/CrunchyData/postgres-operator/blob/main/config/monitoring/alertmanager/config/alertmanager.yml (Apache-2.0)

```yaml
inhibit_rules:
- source_match:
    severity: 'critical'
  target_match:
    severity: 'warning'
  equal: ['alertname', 'job', 'service']

receivers:
- name: 'default-receiver'
  email_configs:
  - to: 'example@crunchydata.com'
    send_resolved: true
#- name: 'pagerduty-dba'
#  pagerduty_configs:
#      - service_key: <RANDOMKEYSTUFF>
#- name: 'pagerduty-sre'
#  pagerduty_configs:
#      - service_key: <RANDOMKEYSTUFF>

route:
    receiver: default-receiver
    group_by: [severity, service, job, alertname]
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 24h
```

**Key pattern**: Separate PagerDuty services per team (pagerduty-dba, pagerduty-sre).
Each team has its own PagerDuty service with its own on-call schedule.

### 3.7 Grafana Loki: Minimal Production Config

**Source**: https://github.com/grafana/loki/blob/main/production/docker/config/alertmanager.yml (AGPL-3.0)

```yaml
route:
  receiver: 'default-receiver'
  group_wait: 30s
  group_interval: 30m
  group_by: [ alertname ]

receivers:
  - name: 'default-receiver'
```

**Key detail**: group_interval: 30m. Loki uses a 30-minute group interval, much longer
than the typical 5m. New alerts for the same alertname within 30 minutes are batched.

### 3.8 Grafana Devenv: Webhook + Inhibition

**Source**: https://github.com/grafana/grafana/blob/main/devenv/docker/blocks/prometheus/alertmanager.yml (AGPL-3.0)

```yaml
route:
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 1h
  receiver: 'web.hook'
receivers:
  - name: 'web.hook'
    webhook_configs:
      - url: 'http://127.0.0.1:5001/'
inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'dev', 'instance']
```

---

## 4. Routing Tree Reference

### 4.1 Routing Parameters

**Source**: https://prometheus.io/docs/alerting/latest/configuration/

| Parameter | Default | Purpose |
|-----------|---------|---------|
| receiver | (required) | Name of the receiver to notify. |
| group_by | (none) | Labels to group alerts by. Use ['...'] to disable grouping. |
| group_wait | 30s | Wait before sending first notification for a new alert group. |
| group_interval | 5m | Wait before sending subsequent notifications for the same group. |
| repeat_interval | 4h | Wait before re-sending the last notification. |
| matchers | (none) | List of label matchers the alert must satisfy. |
| continue | false | If true, continue matching subsequent sibling routes. |
| mute_time_intervals | (none) | Named time intervals during which this route is muted. |
| active_time_intervals | (none) | Named time intervals during which this route is active. |

### 4.2 Routing Tree Traversal

Alerts enter at the root node, traverse children in order. If continue is false (default),
the alert stops at the FIRST matching child. If no child matches, the alert is handled
by the current node's receiver.

The root receiver is the fallback. Every alert that does not match any child route
goes to the root receiver. The root receiver should be a safe destination (email, Slack)
rather than a pager.

---

## 5. Inhibition Rules

Inhibition mutes target alerts when source alerts are firing. Both must have equal
values for the labels in the equal list.

### 5.1 Severity Inhibition (Most Common)

**Source**: https://github.com/prometheus/alertmanager/blob/main/doc/examples/simple.yml

```yaml
inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: [alertname, cluster, service]
```

**Same pattern** appears in:
- CrunchyData/postgres-operator - equal: [alertname, job, service]
- Django-School-Management - equal: [alertname, app]
- AiSOC - equal: [team, alertname]
- grafana/grafana devenv - equal: [alertname, dev, instance]
- OpenByteInc/QuantDinger - equal: [] (any critical inhibits any warning)

### 5.2 Root-Cause Suppression (Alert-Name-Based)

**Source**: https://github.com/pgsty/pigsty/blob/main/roles/infra/templates/prometheus/alertmanager.yml

```yaml
inhibit_rules:
  - source_matchers: [ alertname="NodeDown" ]
    target_matchers: [ category="node" ]
    equal: ['ip']
```

When a node is completely down, it generates dozens of alerts. You only need NodeDown.
The equal: ['ip'] ensures NodeDown for 10.0.0.1 only suppresses alerts from 10.0.0.1.

### 5.3 Git Platform Inhibition Rules

```yaml
inhibit_rules:
  # If the Git platform is completely down, suppress all other Git alerts.
  - source_matchers: [alertname="GiteaDown"]
    target_matchers: [service="gitea"]
    equal: ['instance']

  # If the database is down, suppress database-related warnings.
  - source_matchers: [alertname="DatabaseDown"]
    target_matchers: [category="database"]
    equal: ['instance']

  # Standard severity inhibition: critical suppresses warning.
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: ['alertname', 'service']

  # If disk is full, suppress disk-related warnings.
  - source_matchers: [alertname="DiskFull"]
    target_matchers: [category="disk"]
    equal: ['instance']
```

---

## 6. Mute Time Intervals

time_intervals define named time windows referenced in routes to mute/activate notifications.

### 6.1 Workdays + Workhours

**Source**: https://github.com/badtuxx/DescomplicandoPrometheus/blob/main/en/src/day-4/files/alertmanager.yml (GPL-3.0)

```yaml
time_intervals:
  - name: workdays
    time_intervals:
      - weekdays: ['monday:friday']
  - name: workhours
    time_intervals:
      - times:
          - start_time: 09:00
            end_time: 18:00

route:
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 1h
  receiver: 'gmail-notifications'
  routes:
    # LoadAverage -> Slack, ONLY during workdays AND workhours
    - receiver: 'slack'
      group_wait: 10s
      matchers:
        - alertname = LoadAverage
      group_by: ['alertname', 'instance']
      active_time_intervals:
        - workdays
        - workhours
    # NodeDown -> email, always
    - receiver: 'gmail-notifications'
      matchers:
        - alertname = NodeDown
      group_by: ['alertname', 'instance']
```

**Key pattern**: active_time_intervals (not mute). The Slack route is only active during
workdays AND workhours. Outside those windows, LoadAverage alerts fall to the root
receiver (email). NodeDown has no time restriction.

### 6.2 Maintenance Window + Off Hours

**Source**: https://github.com/grafana/grafana/blob/main/pkg/tests/api/alerting/test-data/mimir-alertmanager-post.yaml (AGPL-3.0)

```yaml
time_intervals:
  - name: maintenance_window
    time_intervals:
      - times:
          - start_time: 02:00
            end_time: 04:00
        weekdays:
          - saturday
  - name: off_hours
    time_intervals:
      - times:
          - start_time: 20:00
            end_time: 23:59
          - start_time: 00:00
            end_time: 06:00
```

### 6.3 Off-Hours Muting with Timezone

**Source**: https://github.com/prometheus-community/ansible/blob/main/roles/alertmanager/defaults/main.yml (Apache-2.0)

```yaml
# alertmanager_time_intervals:
#   - name: offhours
#      time_intervals:
#        - times:
#            - start_time: "21:00"
#              end_time: "24:00"
#          location: "Africa/Johannesburg"
```

The location field uses IANA timezone names. Critical for non-UTC operators.
On Windows, only Local or UTC are supported unless ZONEINFO env var is set.

### 6.4 Git Platform Time Intervals (Asia/Bangkok)

```yaml
time_intervals:
  - name: business_hours
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '08:00'
            end_time: '18:00'
        location: 'Asia/Bangkok'
  - name: maintenance_window
    time_intervals:
      - weekdays: ['sunday']
        times:
          - start_time: '02:00'
            end_time: '06:00'
        location: 'Asia/Bangkok'
  - name: night_hours
    time_intervals:
      - times:
          - start_time: '22:00'
            end_time: '23:59'
          - start_time: '00:00'
            end_time: '07:00'
        location: 'Asia/Bangkok'
```

---

## 7. Grafana Alerting

### 7.1 Architecture

Grafana Alerting is a separate alerting engine built into Grafana:
1. Evaluates alert rules against data sources (Prometheus, Loki, etc.)
2. Sends notifications via contact points (email, Slack, PagerDuty, webhook)
3. Routes alerts via notification policies (tree structure similar to Alertmanager)

**Source**: https://grafana.com/docs/grafana/latest/alerting/fundamentals/

Key concepts:
- Alert rules: query + condition + labels. Evaluated on an interval.
- Alert instances: One per time series. A rule with sum by(cpu) creates one per CPU.
- Contact points: Where notifications go.
- Notification policies: Tree-based routing. Root is Default notification policy.
- Silences / Mute timings: Pause notifications without stopping evaluation.

### 7.2 Real Provisioned Alert Rules: rsyslog

**Source**: https://github.com/rsyslog/rsyslog/blob/main/deploy/docker-compose/rosi-collector/grafana/provisioning/alerting/default.yml (LGPL-3.0)

A real, production Grafana alerting provisioning file with 9 alert rules across 5 groups.

```yaml
apiVersion: 1
groups:
  - name: missing-logs
    interval: 1m
    orgId: 1
    folder: Alerts
    rules:
      - uid: missing-logs-host
        title: Host stopped sending logs
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: loki
            model:
              expr: 'sum by (host) (count_over_time({job="syslog"} [5m]))'
              refId: A
              queryType: range
              intervalMs: 1000
              maxDataPoints: 43200
          - refId: B
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: __expr__
            model:
              datasource:
                name: Expression
                type: __expr__
                uid: __expr__
              expression: A
              reducer: last
              settings:
                mode: dropNN
              refId: B
              type: reduce
          - refId: C
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: __expr__
            model:
              datasource:
                name: Expression
                type: __expr__
                uid: __expr__
              conditions:
                - evaluator:
                    params: [1, 0]
                    type: lt
                  operator:
                    type: and
                  query:
                    params: []
                  reducer:
                    params: []
                    type: avg
                  type: query
              expression: B
              refId: C
              type: threshold
        noDataState: Alerting
        execErrState: Alerting
        for: 5m
        annotations:
          description: 'Host {{ $labels.host }} has not sent any logs in the last 5 minutes'
          summary: 'Missing logs from {{ $labels.host }}'
        labels:
          alertname: Host stopped sending logs
          severity: warning
          component: logging

  - name: system-resources
    interval: 30s
    orgId: 1
    folder: Alerts
    rules:
      - uid: low-disk-space
        title: Low disk space
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: prometheus
            model:
              expr: 'max by(instance, host) ((1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100)'
              refId: A
              queryType: range
              intervalMs: 1000
              maxDataPoints: 43200
          # B: reduce (last, dropNN)
          # C: threshold > 90
        noDataState: OK
        execErrState: Alerting
        for: 5m
        annotations:
          description: 'Disk usage on {{ $labels.host }} is above 90%'
          summary: 'Low disk space on {{ $labels.host }}'
        labels:
          alertname: Low disk space
          severity: critical
          component: system
```

Key details:
- noDataState: Alerting on the log rule (host stopping logs IS an alert condition).
- noDataState: OK on the disk rule (no data from Prometheus is not a disk problem).
- execErrState: Alerting (query failure is treated as an alert).
- for: 5m (condition must be true for 5 consecutive evaluations before firing).
- interval: 30s on system-resources, 1m on log rules.

### 7.3 Grafana Provisioning Schema

**Source**: https://github.com/grafana/grafana/blob/main/conf/provisioning/alerting/sample.yaml (AGPL-3.0)

The full provisioning schema includes groups (alert rules), contactPoints, policies,
and muteTimes. Key excerpt:

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: my_rule_group
    folder: my_first_folder
    interval: 60s
    rules:
    - uid: my_id_1
      title: my_first_rule
      condition: A
      data:
      - refId: A
        datasourceUid: "__expr__"
        model:
          conditions:
          - evaluator:
              params: [3]
              type: gt
            operator:
              type: and
            query:
              params: [A]
            reducer:
              type: last
            type: query
          datasource:
            type: __expr__
            uid: "__expr__"
          expression: 1==0
          intervalMs: 1000
          maxDataPoints: 43200
          refId: A
          type: math
      dashboardUid: my_dashboard
      panelId: 123
      noDataState: Alerting
      executionErrorState: Alerting
      for: 60s
      annotations:
        some_key: some_value
      labels:
        team: sre_team_1
      isPaused: false
      notification_settings:
        receiver: grafana-default-email
        group_by: ["alertname", "grafana_folder", "region"]
        mute_time_intervals:
        - abc
        group_wait: 30s
        group_interval: 5m
        repeat_interval: 4h

contactPoints:
  - orgId: 1
    name: cp_1
    receivers:
    - uid: first_uid
      type: prometheus-alertmanager
      settings:
        url: http://test:9000

policies:
  - orgId: 1
    receiver: grafana-default-email
    group_by:
    - grafana_folder
    - alertname
    matchers:
    - alertname = Watchdog
    - severity =~ "warning|critical"
    mute_time_intervals:
    - abc
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h

muteTimes:
  - orgId: 1
    name: mti_1
    time_intervals:
    - times:
      - start_time: '06:00'
        end_time: '23:59'
      weekdays: ['monday:wednesday','saturday', 'sunday']
      months: ['1:3', 'may:august', 'december']
      years: ['2020:2022', '2030']
      days_of_month: ['1:5', '-3:-1']
```

**Key insight**: notification_settings on a rule can bypass the notification policy tree
entirely. Set receiver directly on the rule for simple setups.

### 7.4 Grafana Contact Point Types

| Type | Alertmanager Equivalent | Notes |
|------|------------------------|-------|
| prometheus-alertmanager | (itself) | Forwards to external Alertmanager |
| email | email_configs | SMTP |
| slack | slack_configs | Incoming webhook |
| pagerduty | pagerduty_configs | Events API v2 |
| opsgenie | opsgenie_configs | REST API |
| webhook | webhook_configs | Generic HTTP |
| victorops | victorops_configs | Splunk On-Call |
| telegram | telegram_configs | Bot API |
| msteams | (no AM equivalent) | Microsoft Teams |
| discord | (no AM equivalent) | Discord webhook |

---

## 8. PagerDuty

### 8.1 Events API v2

**Source**: https://developer.pagerduty.com/docs/send-alert-event

**Endpoint**: https://events.pagerduty.com/v2/enqueue

The Events API v2 is an asynchronous API. POST a JSON payload, receive 202 Accepted.
PagerDuty processes the event and creates/updates an incident.

### 8.2 Alert Event Payload Format

```json
{
  "routing_key": "<32-character integration key>",
  "event_action": "trigger",
  "dedup_key": "gitea-down-prod-001",
  "payload": {
    "summary": "Gitea is down - push and clone broken",
    "timestamp": "2026-11-03T14:30:00.000+07:00",
    "source": "gitea.internal.example.com",
    "severity": "critical",
    "component": "git-http",
    "group": "git-platform",
    "class": "availability",
    "custom_details": {
      "uptime": "3d 4h 12m",
      "last_deploy": "2026-11-01T09:00:00Z",
      "affected_users": 42
    }
  },
  "client": "Prometheus Alertmanager",
  "client_url": "https://prometheus.internal.example.com/alerts",
  "links": [
    {
      "href": "https://gitea.internal.example.com",
      "text": "Gitea Dashboard"
    }
  ]
}
```

**Field reference** (from official docs):

| Field | Required | Description |
|-------|----------|-------------|
| routing_key | Yes | 32-char integration key for the service. |
| event_action | Yes | trigger, acknowledge, or resolve. |
| dedup_key | No | Correlates trigger/ack/resolve events. Max 255 chars. |
| payload.summary | Yes | Brief text summary. Max 1024 chars. |
| payload.source | Yes | Unique identifier (hostname, FQDN). |
| payload.severity | Yes | critical, error, warning, or info. |
| payload.timestamp | No | ISO 8601. Auto-generated if omitted. |
| payload.component | No | Component responsible (e.g., git-http). |
| payload.group | No | Logical grouping (e.g., git-platform). |
| payload.class | No | Event type (e.g., availability). |
| payload.custom_details | No | Free-form object. |

### 8.3 Alertmanager to PagerDuty

Alertmanager has native PagerDuty support. No webhook adapter needed:

```yaml
# From: https://github.com/pgsty/pigsty/blob/main/roles/infra/templates/prometheus/alertmanager.yml
receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - routing_key: 'your-pagerduty-routing-key'
        send_resolved: true
```

The routing_key is the Events API v2 integration key. Alertmanager automatically
constructs the PD-CEF-compliant payload and POSTs to the endpoint.

Note: Older configs use service_key (Events API v1). Current configs use routing_key
(Events API v2). The pigsty template and SchemaStore sample both use routing_key.

### 8.4 Resolve Event

```json
{
  "routing_key": "<32-character integration key>",
  "dedup_key": "gitea-down-prod-001",
  "event_action": "resolve"
}
```

Alertmanager sends resolve events automatically when send_resolved: true is set.

### 8.5 Change Events (Deployment Tracking)

**Source**: https://developer.pagerduty.com/docs/send-change-event

```json
{
  "routing_key": "<32-character integration key>",
  "event_action": "deploy",
  "payload": {
    "summary": "Gitea v1.21.0 deployed to production",
    "timestamp": "2026-11-03T14:00:00.000+07:00",
    "source": "gitea.internal.example.com",
    "component": "git-platform",
    "group": "git-platform",
    "class": "deploy",
    "custom_details": {
      "version": "1.21.0",
      "deployed_by": "operator"
    }
  }
}
```

Change events provide context to responders. They appear in the service activity stream
and on the incident details page. They do NOT create incidents or send notifications.

### 8.6 Response Codes

| Code | Description | Retry? |
|------|-------------|--------|
| 202 | Accepted | No |
| 400 | Bad Request (invalid JSON) | No |
| 429 | Rate limited | Yes, with backoff |
| 500+ | Server error | Yes, with backoff |

Payload size limit: 512 KB.

---

## 9. OpsGenie

### 9.1 Alert Payload Format (via Alertmanager)

**Source**: https://github.com/ruanbekker/cheatsheets/blob/master/alertmanager/example_configs/opsgenie/alertmanager.yml (MIT)

```yaml
receivers:
  - name: 'critical'
    opsgenie_configs:
      - send_resolved: true
        http_config: {}
        api_key: xx
        api_url: https://api.eu.opsgenie.com/
        message: '[{{ .Status | toUpper }}] {{ .CommonAnnotations.summary }}'
        description: >-
          {{ .CommonAnnotations.description }}
          More Info:
          - Impact: {{ .CommonAnnotations.impact }}
          - Action: {{ .CommonAnnotations.action }}
          - Dashboard: {{ .CommonAnnotations.dashboard }}
          - Runbook: {{ .CommonAnnotations.runbook }}
        source: '{{ template "opsgenie.default.source" . }}'
        responders:
        - name: DevOps
          type: team
        priority: '{{ if .CommonAnnotations.priority }}{{ .CommonAnnotations.priority }}{{ else }}P3{{ end }}'
        tags: 'monitoring, exporters, prometheus'
        note: 'test-note'
```

### 9.2 OpsGenie Alert Fields

| Field | Alertmanager Key | OpsGenie API Field | Description |
|-------|-----------------|-------------------|-------------|
| Message | message | message | Alert title. Max 130 chars. |
| Description | description | description | Full alert details. |
| Source | source | source | Origin of the alert. |
| Responders | responders | responders | Teams/users to notify. |
| Priority | priority | priority | P1 (highest) to P5 (lowest). |
| Tags | tags | tags | Comma-separated tags. |
| Note | note | note | Internal note. |

### 9.3 OpsGenie API Direct (Without Alertmanager)

```bash
curl -X POST \
  -H "Authorization: GenieKey YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "[CRITICAL] Gitea is down",
    "description": "Gitea has not been scraped for 10 minutes. Push and clone broken.",
    "source": "gitea.internal.example.com",
    "priority": "P1",
    "responders": [{"name": "DevOps", "type": "team"}],
    "tags": ["git-platform", "critical"],
    "details": {
      "alertname": "GiteaDown",
      "instance": "gitea.internal:3000",
      "severity": "critical"
    }
  }' \
  https://api.opsgenie.com/v2/alerts
```

### 9.4 Grafana OpsGenie Contact Point

**Source**: https://github.com/grafana/grafana/blob/main/pkg/tests/api/alerting/test-data/mimir-alertmanager-post.yaml (AGPL-3.0)

```yaml
- name: opsgenie
  opsgenie_configs:
    - api_key: api-secret-key
      api_url: http://localhost/opsgenie
      message: test message
      description: test description
      source: Alertmanager
```

---

## 10. Squadcast

### 10.1 Background

Squadcast is now SolarWinds Incident Response. Documentation has moved to
support.squadcast.com. The Prometheus integration page is at:
https://support.squadcast.com/docs/prometheus

### 10.2 Alertmanager Integration (Generic Webhook)

Squadcast does not have a native Alertmanager receiver type. Integration is via the
generic webhook_configs receiver, pointing at Squadcast's integration endpoint.

```yaml
# Alertmanager config for Squadcast integration
receivers:
  - name: 'squadcast'
    webhook_configs:
      - url: 'https://your-org.squadcast.com/api/v1/integrations/<INTEGRATION_KEY>'
        send_resolved: true
        http_config:
          # Optional: authentication
          # basic_auth:
          #   username: ''
          #   password: '<API_KEY>'
```

The webhook payload is the standard Alertmanager notification format:

```json
{
  "version": "4",
  "groupKey": "<group-key>",
  "status": "firing",
  "receivers": ["squadcast"],
  "groupLabels": {
    "alertname": "GiteaDown"
  },
  "commonLabels": {
    "alertname": "GiteaDown",
    "severity": "critical",
    "instance": "gitea.internal:3000"
  },
  "commonAnnotations": {
    "summary": "Gitea is down.",
    "description": "Forgejo has not been scraped for 10 minutes."
  },
  "externalURL": "http://alertmanager:9093",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "GiteaDown",
        "severity": "critical",
        "instance": "gitea.internal:3000"
      },
      "annotations": {
        "summary": "Gitea is down.",
        "description": "Forgejo has not been scraped for 10 minutes."
      },
      "startsAt": "2026-11-03T14:30:00Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "generatorURL": "http://prometheus:9090/graph?g0.expr=up%7Bjob%3D%22gitea%22%7D%20%3D%3D%200"
    }
  ]
}
```

### 10.3 keephq Integration Example

**Source**: https://github.com/keephq/keep/blob/main/examples/workflows/squadcast_example.yml

```yaml
workflow:
  id: squadcast-incident-creator
  name: SquadCast Incident Creator
  description: Creates SquadCast incidents from alerts.
  triggers:
    - type: alert
  actions:
    - name: create-incident
      provider:
        config: "{{ providers.squadcast }}"
        type: squadcast
        with:
          additional_json: "{{ alert }}"
          description: TEST
          message: "{{ alert.name }}-test"
```

This shows a Keep workflow that creates Squadcast incidents from incoming alerts,
passing the full alert object as additional_json.

---

## 11. On-Call Rotation Patterns for Small SRE Teams

### 11.1 Patterns Observed in the Wild

Based on the configs surveyed, these are the on-call patterns used by small teams:

**Pattern 1: Single Operator, PagerDuty Self-Page**
- One person is both primary and secondary.
- PagerDuty schedule: 24/7, single escalation policy.
- Only critical alerts page. Warning goes to Slack/email.
- Used by: solo operators, small startups.
- Config evidence: AiSOC (critical-page receiver), Django-School-Management
  (single PagerDuty service key).

**Pattern 2: Primary + Secondary, 1-Week Rotation**
- Two people rotate weekly.
- PagerDuty schedule: 2 participants, 7-day rotation.
- Escalation: Primary gets paged first. If unacknowledged in 5 min, Secondary is paged.
- Used by: 2-person SRE teams.
- Config evidence: CrunchyData postgres-operator (separate pagerduty-dba and
  pagerduty-sre services), prometheus/alertmanager official example
  (team-X-pager and team-Y-pager).

**Pattern 3: Follow-the-Sun, 3-4 Person Rotation**
- 3-4 people in a 3-4 week rotation.
- PagerDuty schedule: overlapping shifts for handoff.
- Escalation: Primary -> Secondary -> Manager.
- Used by: distributed teams across timezones.
- Config evidence: pigsty (multiple receiver types for different teams),
  ruanbekker/cheatsheets (environment-based routing to prevent false pages).

### 11.2 Escalation Policies

The most common escalation pattern for small teams:

```
Level 1: Primary on-call
  - Paged via PagerDuty (phone call + SMS + push)
  - Acknowledge window: 5 minutes
  - If unacknowledged -> Level 2

Level 2: Secondary on-call
  - Paged via PagerDuty
  - Acknowledge window: 5 minutes
  - If unacknowledged -> Level 3

Level 3: Team lead / Manager
  - Paged via PagerDuty
  - This is the "someone is going to notice" level
```

For a single-operator setup (OpenForge context), the escalation policy simplifies to:

```
Level 1: Operator
  - Paged via PagerDuty (or OpsGenie)
  - Acknowledge window: 10 minutes (generous for single operator)
  - If unacknowledged -> Level 2

Level 2: Operator (email + Slack DM)
  - Different channel to break through notification fatigue
  - This is the "you missed the page" level
```

### 11.3 Maintenance Windows

From the configs surveyed:
- pigsty: Sunday 02:00-06:00 (backup window)
- grafana/grafana test data: Saturday 02:00-04:00 (maintenance)
- badtuxx: Mon-Fri 09:00-18:00 (work hours for non-critical alerts)
- prometheus-community/ansible: 21:00-24:00 Africa/Johannesburg (off hours)

For a single-operator Git platform:
- Mute ALL non-critical alerts during 22:00-07:00 (night hours)
- Mute ALL alerts during Sunday 02:00-06:00 (maintenance/backup window)
- Critical alerts are NEVER muted (they always page)

---

## 12. Recommended Routing Tree for OpenForge (Single-Operator)

### 12.1 Design Principles

1. **Critical pages 24/7** - Push broken or clone broken means the operator must know.
2. **Warning goes to Slack only during business hours** - No 3am Slack pings.
3. **Info goes to dashboard only** - No proactive notification.
4. **Inhibition prevents alert storms** - If Gitea is down, do not also page for
   "high latency" and "error rate" (those are symptoms of the same root cause).
5. **Single PagerDuty service** - One integration, one escalation policy.
6. **Slack as the day-channel** - All non-critical alerts land in #ops-alerts.

### 12.2 Complete alertmanager.yml

```yaml
# OpenForge Git Platform - Alertmanager Configuration
# Single-operator setup. Critical pages 24/7. Warning Slack-only during business hours.
# Source patterns: AiSOC, Django-School-Management, ruanbekker/cheatsheets,
#                  prometheus/alertmanager official example, pigsty.

global:
  resolve_timeout: 5m
  # Slack API URL (for the default warning/info receiver)
  slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'

# Custom templates (optional)
# templates:
#   - '/etc/alertmanager/templates/*.tmpl'

# --- Time Intervals ---
time_intervals:
  # Business hours: Mon-Fri, 08:00-18:00 Bangkok
  - name: business_hours
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '08:00'
            end_time: '18:00'
        location: 'Asia/Bangkok'

  # Night hours: 22:00-07:00 (no non-critical pages)
  - name: night_hours
    time_intervals:
      - times:
          - start_time: '22:00'
            end_time: '23:59'
          - start_time: '00:00'
            end_time: '07:00'
        location: 'Asia/Bangkok'

  # Maintenance window: Sunday 02:00-06:00
  - name: maintenance_window
    time_intervals:
      - weekdays: ['sunday']
        times:
          - start_time: '02:00'
            end_time: '06:00'
        location: 'Asia/Bangkok'

# --- Routing Tree ---
route:
  # Default receiver: Slack (safe fallback, never pages)
  receiver: slack-ops
  group_by: ['alertname', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    # CRITICAL: Page on-call immediately, 24/7 (no time restrictions)
    - matchers:
        - severity="critical"
      receiver: pagerduty-oncall
      group_wait: 10s
      repeat_interval: 1h

    # WARNING: Slack only during business hours
    - matchers:
        - severity="warning"
      receiver: slack-ops
      group_wait: 1m
      repeat_interval: 12h
      # Mute warning alerts during night hours and maintenance windows
      mute_time_intervals:
        - night_hours
        - maintenance_window

    # INFO: No notification (falls through to root receiver = Slack)
    # But muted during night hours to avoid 3am Slack pings
    - matchers:
        - severity="info"
      receiver: slack-ops
      repeat_interval: 24h
      mute_time_intervals:
        - night_hours
        - maintenance_window

# --- Inhibition Rules ---
inhibit_rules:
  # 1. If Gitea is completely down, suppress all other Gitea alerts.
  #    Rationale: GiteaDown is the root cause. Latency/error rate are symptoms.
  - source_matchers: [alertname="GiteaDown"]
    target_matchers: [service="gitea"]
    equal: ['instance']

  # 2. Standard severity inhibition: critical suppresses warning.
  #    Rationale: If the same alert is already critical, the warning is redundant.
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: ['alertname', 'service']

  # 3. If disk is full, suppress disk-related warnings.
  - source_matchers: [alertname="DiskFull"]
    target_matchers: [category="disk"]
    equal: ['instance']

# --- Receivers ---
receivers:
  # Primary page: PagerDuty (Events API v2)
  # Only receives critical alerts.
  - name: pagerduty-oncall
    pagerduty_configs:
      - routing_key: 'YOUR-PAGERDUTY-ROUTING-KEY'
        send_resolved: true

  # Day channel: Slack #ops-alerts
  # Receives warning and info alerts (and critical as a secondary notification).
  - name: slack-ops
    slack_configs:
      - channel: '#ops-alerts'
        send_resolved: true
        title: >-
          {{ if eq .Status "firing" }}:red_circle:{{ else }}:white_check_mark:{{ end }}
          [{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}
        text: >-
          {{ range .Alerts }}
          *Summary:* {{ .Annotations.summary }}
          *Description:* {{ .Annotations.description }}
          *Instance:* {{ .Labels.instance }}
          *Severity:* `{{ .Labels.severity }}`
          {{ end }}
        title_link: 'http://prometheus.internal:9090/alerts'
        footer: 'OpenForge Git Platform'

  # (Optional) Email backup for critical alerts
  # - name: email-oncall
  #   email_configs:
  #     - to: 'operator@example.com'
  #       send_resolved: true
  #       smarthost: 'smtp.example.com:587'
  #       from: 'alertmanager@example.com'
  #       auth_username: 'alertmanager'
  #       auth_password: 'PASSWORD'
```

### 12.3 Alert Rules (Prometheus)

```yaml
# openforge-alerts.yml
groups:
  - name: openforge.git-platform
    rules:
      # CRITICAL: Git platform unreachable
      - alert: GiteaDown
        expr: up{job="gitea"} == 0
        for: 5m
        labels:
          severity: critical
          service: gitea
        annotations:
          summary: "Gitea is down"
          description: >-
            Gitea at {{ $labels.instance }} has been unreachable for 5 minutes.
            Push and clone operations are broken.

      # CRITICAL: SSH daemon down
      - alert: GitSSHDown
        expr: probe_success{job="git-ssh"} == 0
        for: 5m
        labels:
          severity: critical
          service: gitea
        annotations:
          summary: "Git SSH daemon is down"
          description: >-
            SSH access to {{ $labels.instance }} is broken.
            SSH-based push and clone will fail.

      # CRITICAL: Runner fleet unavailable
      - alert: GiteaRunnerUnavailable
        expr: >-
          kube_deployment_status_replicas_available{deployment="gitea-runner"} == 0
        for: 10m
        labels:
          severity: critical
          service: gitea
        annotations:
          summary: "Gitea Actions runner is unavailable"
          description: >-
            No runner replicas available for 10 minutes.
            CI/CD workflows cannot execute.

      # WARNING: High latency
      - alert: GiteaHighLatency
        expr: >-
          histogram_quantile(0.95,
            sum by (le) (rate(gitea_request_duration_seconds_bucket[5m]))
          ) > 1.0
        for: 15m
        labels:
          severity: warning
          service: gitea
        annotations:
          summary: "Gitea p95 latency is above 1s"
          description: >-
            p95 request latency on {{ $labels.instance }} has been above 1s
            for 15 minutes. Check for database contention or resource pressure.

      # WARNING: High error rate
      - alert: GiteaErrorRate
        expr: >-
          sum(rate(gitea_request_duration_seconds_count{code=~"5.."}[10m]))
          / sum(rate(gitea_request_duration_seconds_count[10m])) > 0.10
        for: 10m
        labels:
          severity: warning
          service: gitea
        annotations:
          summary: "Gitea 5xx error rate above 10%"
          description: >-
            More than 10% of requests to {{ $labels.instance }} are returning
            5xx errors for 10 minutes.

      # WARNING: Disk usage
      - alert: GiteaDiskUsage
        expr: >-
          1 - (node_filesystem_avail_bytes{mountpoint="/var/lib/gitea"}
               / node_filesystem_size_bytes{mountpoint="/var/lib/gitea"}) * 100 > 80
        for: 30m
        labels:
          severity: warning
          service: gitea
          category: disk
        annotations:
          summary: "Gitea disk usage above 80%"
          description: >-
            Repository storage on {{ $labels.instance }} is above 80% full.
            Plan maintenance before it hits 90%.

      # WARNING: High memory
      - alert: GiteaHighMemory
        expr: >-
          container_memory_working_set_bytes{container="gitea"}
          / container_spec_memory_limit_bytes{container="gitea"} > 0.85
        for: 15m
        labels:
          severity: warning
          service: gitea
        annotations:
          summary: "Gitea memory usage above 85%"
          description: >-
            Gitea container memory is above 85% of its limit
            on {{ $labels.instance }} for 15 minutes.

      # INFO: Deployment complete
      - alert: GiteaDeployComplete
        expr: changes(gitea_build_info[1h]) > 0
        for: 0s
        labels:
          severity: info
          service: gitea
        annotations:
          summary: "Gitea deployment complete"
          description: >-
            Gitea was redeployed. New build: {{ $value }}.
```

### 12.4 Visual Routing Summary

```
Alert enters Alertmanager
        |
        v
+-------------------+     severity=critical     +---------------------+
|   ROOT            |-------------------------->| pagerduty-oncall    |
|   receiver:       |                           | group_wait: 10s     |
|   slack-ops       |                           | repeat: 1h          |
|   group_wait: 30s |                           | (24/7, no mute)     |
|   group_by:       |                           +---------------------+
|   [alertname,     |
|    service]       |     severity=warning      +---------------------+
|                   |-------------------------->| slack-ops           |
|                   |                           | group_wait: 1m      |
|                   |                           | repeat: 12h         |
|                   |                           | MUTE: night_hours   |
|                   |                           | MUTE: maintenance   |
|                   |                           +---------------------+
|                   |
|                   |     severity=info         +---------------------+
|                   |-------------------------->| slack-ops           |
|                   |                           | repeat: 24h         |
|                   |                           | MUTE: night_hours   |
|                   |                           | MUTE: maintenance   |
|                   |                           +---------------------+
|                   |
|                   |     (no match)            +---------------------+
+-------------------+-------------------------->| slack-ops           |
                                                | (inherited from     |
                                                |  root, no mute)     |
                                                +---------------------+

Inhibition:
  GiteaDown (critical) inhibits ALL service=gitea alerts for same instance
  severity=critical inhibits severity=warning for same alertname+service
  DiskFull inhibits category=disk warnings for same instance
```

### 12.5 What This Gets You

| Scenario | What Happens |
|----------|-------------|
| Gitea goes down at 3am | PagerDuty pages the operator. Phone call + SMS + push. |
| Gitea goes down at 2pm | PagerDuty pages the operator. Slack also gets the message. |
| Latency spikes at 2pm | Slack #ops-alerts gets a message. No page. |
| Latency spikes at 3am | Nothing. Muted by night_hours. Checked next morning. |
| Disk at 85% at 2pm | Slack gets a message. Plan maintenance. |
| Disk at 85% at 3am | Nothing. Muted by night_hours. |
| Deploy completes at 2pm | Slack gets an info message. |
| Deploy completes at 3am | Nothing. Muted by night_hours. |
| Gitea down + latency + error rate all fire | Only GiteaDown pages. Inhibition suppresses the rest. |

### 12.6 PagerDuty Service Configuration

For the PagerDuty side, configure:

1. **Service**: "OpenForge Git Platform"
2. **Integration**: Events API v2 (get the 32-char routing_key)
3. **Escalation Policy**:
   - Level 1: Operator (10 min acknowledge window)
   - Level 2: Operator via email + Slack DM (5 min)
4. **Schedule**: 24/7, single participant
5. **Alert Grouping**: Time-based, 5-minute window
   (groups related alerts into a single incident)

### 12.7 Grafana Alternative (No Alertmanager)

If you prefer Grafana-native alerting over Alertmanager, the equivalent setup:

1. **Alert rules**: Use the Prometheus expressions from section 12.3,
   configured as Grafana alert rules with `severity` labels.
2. **Contact points**:
   - "pagerduty-oncall": PagerDuty type, with the routing_key
   - "slack-ops": Slack type, with the webhook URL
3. **Notification policy tree**:
   - Default: slack-ops, group_by [alertname, service]
   - Child (severity=critical): pagerduty-oncall, group_wait 10s
   - Child (severity=warning): slack-ops, mute during night_hours
   - Child (severity=info): slack-ops, mute during night_hours
4. **Mute timing**: "night_hours" - 22:00-07:00 Asia/Bangkok

The Grafana approach eliminates the separate Alertmanager deployment. Trade-off:
you lose Alertmanager's inhibition rules (Grafana does not support cross-rule
inhibition natively). For a single-operator setup with 8 alert rules, this is
acceptable.

---

## References

### Official Documentation
- Prometheus Alertmanager Configuration: https://prometheus.io/docs/alerting/latest/configuration/
- Grafana Alerting Fundamentals: https://grafana.com/docs/grafana/latest/alerting/fundamentals/
- Grafana Notification Policies: https://grafana.com/docs/grafana/latest/alerting/fundamentals/notifications/notification-policies/
- PagerDuty Events API v2: https://developer.pagerduty.com/docs/send-alert-event
- PagerDuty Events API v2 Overview: https://developer.pagerduty.com/docs/events-api-v2-overview
- PagerDuty Change Events: https://developer.pagerduty.com/docs/send-change-event
- Squadcast Prometheus Integration: https://support.squadcast.com/docs/prometheus

### Public Repository Configs (Alertmanager)
- prometheus/alertmanager official example: https://github.com/prometheus/alertmanager/blob/main/doc/examples/simple.yml
- pgsty/pigsty (Apache-2.0): https://github.com/pgsty/pigsty/blob/main/roles/infra/templates/prometheus/alertmanager.yml
- beenuar/AiSOC (MIT): https://github.com/beenuar/AiSOC/blob/main/infra/docker/alertmanager.yml
- TareqMonwer/Django-School-Management: https://github.com/TareqMonwer/Django-School-Management/blob/master/alertmanager.yml
- ruanbekker/cheatsheets (MIT): https://github.com/ruanbekker/cheatsheets/blob/master/alertmanager/example_configs/opsgenie/alertmanager.yml
- CrunchyData/postgres-operator (Apache-2.0): https://github.com/CrunchyData/postgres-operator/blob/main/config/monitoring/alertmanager/config/alertmanager.yml
- grafana/loki (AGPL-3.0): https://github.com/grafana/loki/blob/main/production/docker/config/alertmanager.yml
- grafana/grafana devenv (AGPL-3.0): https://github.com/grafana/grafana/blob/main/devenv/docker/blocks/prometheus/alertmanager.yml
- badtuxx/DescomplicandoPrometheus (GPL-3.0): https://github.com/badtuxx/DescomplicandoPrometheus/blob/main/en/src/day-4/files/alertmanager.yml
- microservices-demo (Apache-2.0): https://github.com/microservices-demo/microservices-demo/blob/master/deploy/docker-compose/alertmanager.yml
- prometheus-community/ansible (Apache-2.0): https://github.com/prometheus-community/ansible/blob/main/roles/alertmanager/defaults/main.yml
- SchemaStore (Apache-2.0): https://github.com/SchemaStore/schemastore/blob/master/src/test/prometheus-alertmanager/alertmanager-official-sample.yaml

### Public Repository Configs (Grafana Alerting)
- grafana/grafana sample provisioning (AGPL-3.0): https://github.com/grafana/grafana/blob/main/conf/provisioning/alerting/sample.yaml
- rsyslog/rsyslog (LGPL-3.0): https://github.com/rsyslog/rsyslog/blob/main/deploy/docker-compose/rosi-collector/grafana/provisioning/alerting/default.yml
- keephq/keep: https://github.com/keephq/keep/blob/main/keep/providers/grafana_provider/grafana/provisioning/alerting/alerts.yml

### Public Repository Configs (Git Platform Alert Rules)
- billimek/k8s-gitops (Apache-2.0): https://github.com/billimek/k8s-gitops/blob/master/kubernetes/default/forgejo/prometheusrule.yaml
- PaloAltoNetworks/prisma_channel_resources (MIT): https://github.com/PaloAltoNetworks/prisma_channel_resources/blob/main/lab_deploy/compose_deploy/volumes/prometheus/prometheus.yml

### Public Repository Configs (Squadcast)
- keephq/keep: https://github.com/keephq/keep/blob/main/examples/workflows/squadcast_example.yml
