---
name: runbook
description: "Operational runbook template for services (symptoms, diagnosis, fixes, escalation)."
version: v1.0.0
category: planning
trigger_phrases:
  - "Runbook"
---
# Runbook: [SERVICE]

**Verantwortlich:** [TEAM]
**URL:** [Prod-URL]
**Repo:** [GitHub]
**Monitoring:** [Dashboard]

## Symptom: [z.B. Service antwortet nicht]

**Diagnose:**
```
curl -s https://service/health
docker logs service --tail 100
```

**Ursachen & Fixes:**
1. [Ursache A] → [Fix A]
2. [Ursache B] → [Fix B]

## Standard-Operationen

### Deployment
```
# ...
```

### Rollback
```
# ...
```

## Eskalation
1. On-Call / Team
2. Senior / Architekt
3. Management
