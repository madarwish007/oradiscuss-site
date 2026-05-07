---
title: 'Part 3 of 3: Updating the Agents from RU5 to RU8, One Estate, One Version, via the Agent Gold Image..'
description: The final post in the OEM 24ai RU5 to RU8 upgrade series, the mass agent update via Gold Image, off-peak batching across DEV, UAT, and PROD, and the validation queries that confirm every host in the estate is on the new RU.
pubDate: 2026-05-08
updatedDate: 2026-05-08
category: oci
tags:
  - OCI, OEM, Upgrade, ACE
cover: /images/blog/cover-part3.png
coverAlt: ''
draft: false
featured: true
---

By: Mahmoud Darwish

There is a moment in every multi-component upgrade where the heavy lifting feels like it is behind you, and you exhale a little too early.

After Article 1, the OMR was on Oracle Database 19.30 with GI MRP 39168344 applied, `datapatch` reporting `SUCCESS`, and the cluster healthy on both nodes. After Article 2, both OMS instances were on 24.1.0.8 plus Holistic 38864999, the console stayed responsive throughout, and the team had switched from offline mode to Online MOS via IDCS. The screenshots looked great. The change request closed cleanly. For about ten minutes, I felt like the upgrade was done.

Then I opened **Setup > Manage Cloud Control > Agents** and the version column told me the truth. A fleet of Management Agents still on **24.1.0.5**, sitting on every monitored host, dutifully shipping metrics to a pair of OMS instances that had moved on without them.

Agents are the part of OEM that nobody thinks about until they have to. There is no Saturday-night maintenance window for them. There is no executive tile that turns yellow when one falls behind by an RU. They sit on database hosts, application hosts, OS hosts, EBS middle tiers, GoldenGate boxes, ZDLRA appliances, and that one crusty AIX server that nobody admits is still in production. Each one is a tiny dependency, each one breaks in its own creative way, and there are too many of them to handle one at a time.

This is the third and final post in the series. It covers exactly what happens between "OMS is on RU8" and "the estate is on RU8." Pushing the agent update out to every monitored host using the **Agent Gold Image**, scheduling the rollout in off-peak batches so production agents get patched on a controlled cadence, and running the SQL and `emcli` queries that confirm the entire fleet has landed at 24.1.0.8.

Three articles. Three layers. One coherent estate. Let's close it out.

#### Why You Cannot Just Leave the Agents Behind

The first question a few DBAs on my team asked, and a fair one, was: do we really need to upgrade the agents right away? The OMS is on RU8, monitoring is working, alerts are firing, the dashboards are green. Why hurry?

Two reasons.

**First, supported version skew is narrow.** Oracle's stated policy for OEM 24ai is that agents are supported at the same RU as the OMS or one RU behind. Once the OMS is at 24.1.0.8, agents at 24.1.0.5 are formally three RUs back. A lot of things still work, OEM is more forgiving here than it has any right to be, but you are accumulating risk. New plug-in versions, new metric extensions, new corrective action types may not deploy correctly to back-rev agents. Some plug-ins outright refuse to deploy to agents below a minimum version. Future Holistic patches will assume the agents are reasonably current.

**Second, the agents see all the new things last.** Every RU between 24.1.0.5 and 24.1.0.8 includes agent-side changes, fixed memory leaks in the metric collector, new metric definitions, JDK updates that close CVEs, and support for newer target types. Until the agent is on the same RU as the OMS, you are running the OMS on the 2026 codebase while the agents are running the metric collectors from a year ago. The fleet feels less responsive than it should. That feeling is real.

The agents come along. The only question is when, and the right answer is "as soon as the OMS is stable on the new RU."

#### Two Ways to Update Agents, and Why I Picked the One That Looks Slower

There are two supported ways in OEM 24ai to take an agent from one RU to another:

**Option A, single-agent updates with `emcli update_agents`.** Pick an agent, run the verb, watch it patch, move on. Fine for five agents on a small lab. A nightmare at scale, because each upgrade is its own job, its own log file, its own moment of truth, and you have no way to enforce that "all production agents in cluster X get the same version applied in the same window."

**Option B, the Agent Gold Image.** You declare a known-good version of the agent, specifically a snapshot of an installed and configured agent home plus its plug-ins, as the **Gold Image**. You subscribe a set of agents to that image. When you create a new image version, all subscribed agents become eligible to update via a bulk job. The Gold Image enforces standardization, the agents are not just upgraded, they are reconciled to a known-good version including a specific plug-in set.

For one agent, Option A wins on simplicity. For a fleet, Option B is the only sane answer. The Gold Image is also the model Oracle's documentation recommends for any environment with more than a handful of agents, because the operational properties are different. You are not running individual upgrade jobs, you are managing fleet membership.

I went with Gold Image. Everything that follows assumes you did the same.

#### Why Online MOS Mode From Article 2 Pays Off Here

This is where the connectivity flip from the previous article delivers in a way I did not fully appreciate when we made the change.

In **offline mode**, getting the new agent software on the OMS is a manual choreography. Download the agent zip from MOS for every supported platform you have agents on, that is at least Linux x86-64, sometimes also Linux ARM, sometimes AIX, sometimes Solaris, stage each one on the OMS, import each one into Self Update via the offline catalog ZIP, then build a Gold Image from each platform's binaries. None of it is hard. It is half a day of moving zip files around for nothing.

In **online mode**, OEM does the prep for you. **Setup > Extensibility > Self Update > Agent Software** shows you every platform's agent at the new RU, you click Download, and the import is automatic. The first thing I noticed after running my first Self Update sync post-OMS-upgrade was the Agent Software section quietly populating with 24.1.0.8 binaries for every platform we had agents on. We had not even started the agent rollout yet, the OMS had already done the prep work.

If you are still in offline mode at this stage of the series, push for the security exception. The operational time savings on the agent side alone are worth the security review.

#### Step 1: Confirm the New Agent Software is Available in Self Update

Before building the Gold Image, confirm the 24.1.0.8 agent software is on the OMS for every platform in your estate. From the console:

**Setup > Extensibility > Self Update > Agent Software**

You should see a row per platform with the 24.1.0.8.0 version listed and a status of `Applied` or `Downloaded`. If a platform shows the version as `Available` only, click **Download**, in online mode the import completes in a few minutes per platform.

For the platforms in our estate, all Linux x86-64, the row showed:

```plain
Status     Platform           Version
Applied    Linux x86-64       24.1.0.8.0
```

If you prefer the command line for the download step:

```bash
# As oracle on the primary OMS
$OMS_HOME/bin/emcli login -username=sysman
$OMS_HOME/bin/emcli get_agentimage \
    -destination=/u01/app/oracle/em_shared_fs/agentimage \
    -platform="Linux x86-64" \
    -version=24.1.0.8.0
```

This stages the agent software on the shared filesystem, useful if you ever need to install a fresh agent manually outside the Gold Image flow.

#### Step 2: Create the New Gold Image Version

If you already have a Gold Image defined from a previous RU cycle, and you should, if you have been managing your fleet this way, you are creating a new **version** under the same Image. If this is your first Gold Image, you are creating the Image itself and seeding it with version 1.

The source for the Gold Image is a **freshly-installed standalone agent** at the target RU. We took the simpler route: install one new agent on a small dev host on the new 24.1.0.8 binaries, deploy exactly the plug-in set we want every other agent to match, then snapshot it as the Gold Image source. The Image takes a copy of this agent's home, including plug-ins, so the source needs to be exactly the configuration you want enforced across the fleet.

To create the new version via `emcli`:

```bash
$OMS_HOME/bin/emcli create_gold_agent_image \
    -image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8" \
    -source_agent="goldagent01.example.com:3872" \
    -description="Linux x86-64 Agent Gold Image, RU8 (24.1.0.8.0)"
```

The build runs as a background activity. To watch it:

```bash
$OMS_HOME/bin/emcli list_gold_agent_image_activities -image_name="LINUX_X64_AGENT_GI"
```

When the activity status reaches `SUCCEEDED`, the new version is registered. Confirm:

```bash
$OMS_HOME/bin/emcli get_gold_agent_image_details \
    -image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8"
```

Output (abbreviated):

```plain
Image Name        : LINUX_X64_AGENT_GI
Version Name      : V_24_1_0_8
Status            : Active
Agent Version     : 24.1.0.8.0
Source Agent      : goldagent01.example.com:3872
```

The same can be done from the console at **Setup > Manage Cloud Control > Gold Images**. I prefer the `emcli` flow for documentation purposes, the commands and outputs end up directly in the change request.

#### Step 3: Subscribe the Agents to the Gold Image

Subscription is the mechanism that says "this agent should be reconciled to this Gold Image." If your agents were already subscribed to a previous Image version (which they should have been from the previous RU cycle), the subscription itself does not change, what changes is which version they reconcile against next.

To check current subscriptions:

```bash
$OMS_HOME/bin/emcli list_agents_on_gold_image \
    -image_name="LINUX_X64_AGENT_GI"
```

This returns every agent currently subscribed to the image, regardless of which version it is running. Compare the count against your inventory of monitored hosts. Anything missing, subscribe now:

```bash
# Subscribe a single agent
$OMS_HOME/bin/emcli subscribe_agents \
    -gold_image_name="LINUX_X64_AGENT_GI" \
    -agents="agent1.example.com:3872"
```

For a batch, build a flat file of agent names (one per line) and loop:

```bash
# As oracle on the OMS, agentlist.txt is one agent per line
while read AG; do
  $OMS_HOME/bin/emcli subscribe_agents \
      -gold_image_name="LINUX_X64_AGENT_GI" \
      -agents="${AG}"
done < agentlist.txt
```

I keep agentlist files in version control so the subscription state of the fleet is reproducible and auditable.

A reality check before scheduling the rollout, list the agents that are eligible to update to the new version:

```bash
$OMS_HOME/bin/emcli get_updatable_agents \
    -image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8"
```

The output is your work list for the upgrade window. If the count matches the subscribed-agent count minus any agents already at 24.1.0.8 (typically zero at this point), you are ready to schedule.

#### Step 4: Schedule the Update in Off-Peak Batches

This is the step where I had to slow down and think before clicking. The Gold Image update can take every subscribed agent in one job. Technically supported. Operationally a bad idea.

Two reasons not to do it in one shot:

**First, agents on database hosts blackout themselves and the host targets during the update.** A 30-second restart per agent, multiplied across 100 production hosts, is 100 small monitoring blips. Done in serial, that is a 50-minute monitoring gap on someone's most critical host. Done in parallel, all your dashboards turn yellow at the same moment.

**Second, when something goes wrong on agent #4 of 100, you want the failure contained.** Plug-in version mismatches happen. Permission issues on the agent home happen. Old `agent_home/bin` references in cron jobs happen. Catching the first failure with 96 agents still untouched is a much better operational position than catching it with 4 left.

The way I batched the rollout:

| Batch | Targets | Window |
| --- | --- | --- |
| 1 | DEV agents (all) | Tuesday 14:00, lunch hour, low load |
| 2 | UAT agents (all) | Wednesday 14:00 |
| 3 | PROD batch A (50%) | Friday 22:00, off-peak, weekend on standby |
| 4 | PROD batch B (50%) | Saturday 22:00 |

DEV first because the cost of a stuck DEV agent is zero. UAT next because if anything is going to break, the DEV pass is where it usually shows up. PROD in two halves so that if Friday's batch surfaces a problem, Saturday is a recovery window with the change record already booked.

The actual update command for a batch:

```bash
# As oracle on the OMS, agents_batch1.txt is one agent name per line
$OMS_HOME/bin/emcli update_agents \
    -gold_image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8" \
    -input_file="agents_file:agents_batch1.txt"
```

The same flow is available from the console at **Setup > Manage Cloud Control > Update Agents > Add Agents > Submit Job**, with a wizard for selecting agents, choosing a schedule, and configuring optional pre-update and post-update scripts.

For each batch, I scheduled the job ahead of the maintenance window so the batch starts itself. Notifications go to the on-call email. The team does not need to be at a keyboard for a routine batch, only when the first failure shows up.

#### Step 5: What the Update Job Actually Does to Each Agent

For each agent in the batch, the procedure runs a sequence worth understanding so you can troubleshoot it when something goes wrong:

1. **Pre-checks**, the OMS confirms the agent is reachable, the agent home has enough free space (typically 4-5 GB needed for the staging area), the OS is supported, and the plug-in versions on the agent match what the Gold Image specifies
2. **Stages the new agent home**, the OMS pushes the new binaries to the agent host into a parallel directory next to the current agent home, this is the new home that will replace the current one
3. **Stops the agent** (`emctl stop agent`) on the target host
4. **Switches the active home** to the new directory and updates the wrapper or symlink that the OS uses to invoke the agent
5. **Starts the agent** (`emctl start agent`) from the new home
6. **Waits for the agent to register** with the OMS and confirms uploads start landing
7. **Runs post-checks**, confirms the agent target version reported in the OMR matches the new RU, confirms the plug-in versions are correct
8. **Marks the procedure step succeeded** for that agent and moves to the next

The whole sequence takes about 3-5 minutes per agent in our environment. The only step that is "downtime" is the stop-to-start gap, typically under 30 seconds. The agent's monitored targets are blacked out for that window automatically by the procedure, no false alerts fire.

When the update runs across 50 agents in series, expect roughly 2.5 to 4 hours wall time per batch. To run agents in parallel, set the parallelism in the job submission, we used 5 parallel threads in DEV and 3 in PROD, conservative because the slower the rollout, the more time you have to react to the first failure.

To watch a running batch from the command line:

```bash
$OMS_HOME/bin/emcli get_gold_agent_image_activity_status \
    -image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8"
```

Or from the console: **Enterprise > Job > Activity > Filter by Type > Agent Update**. The job page shows per-agent status in real time, which is also where you spot the first failure quickly.

#### Step 6: Estate-Wide Validation

When all four batches complete, the validation question is the simplest in the whole upgrade: is every agent in the estate at 24.1.0.8?

Three views, each catches a different class of mistake.

**View 1, agent count by version, from the OMR.**

```sql
-- Connect to the OMR as SYSMAN
SELECT
    target_version,
    COUNT(*) AS agent_count
FROM
    mgmt$target
WHERE
    target_type = 'oracle_emd'
GROUP BY
    target_version
ORDER BY
    target_version;
```

Expected output after a clean run:

```plain
TARGET_VERSION    AGENT_COUNT
----------------  -----------
24.1.0.8.0        117
```

A single row at the new version. If you see two rows, you have stragglers.

**View 2, subscribed but not yet on the latest version, via emcli.**

```bash
$OMS_HOME/bin/emcli get_updatable_agents \
    -image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8"
```

Expected: the result set is empty. If non-empty, those agents either failed the procedure or are unreachable. The next section covers what to do with them.

**View 3, plug-in version sanity, from the OMR.**

```sql
SELECT
    target_name,
    target_version,
    type_meta_ver
FROM
    mgmt$target
WHERE
    target_type = 'oracle_emd'
    AND target_version <> '24.1.0.8.0';
```

The catch-all for "the binary is upgraded but something on the agent side is not yet aligned." It should return zero rows.

When all three views return what they should, the estate is on RU8. The agents are caught up.

#### Step 7: The Stragglers and What to Do With Them

In a real environment, you will have stragglers. We had three. None of them dramatic, all of them instructive.

**Straggler 1, a host where the agent home was on a partition with insufficient free space.**

The Gold Image update needs roughly 4-5 GB of free space in the agent home parent directory to stage the new binaries. On one host, that partition was tight. The pre-check caught it and the update job marked the agent as failed cleanly, no harm done.

Fix: extended the partition, re-ran the agent update for that one agent:

```bash
$OMS_HOME/bin/emcli update_agents \
    -gold_image_name="LINUX_X64_AGENT_GI" \
    -version_name="V_24_1_0_8" \
    -agents="agentX.example.com:3872"
```

Took 6 minutes once the disk was right.

**Straggler 2, an agent on a host that had been decommissioned without anyone updating OEM.**

Fix: removed the agent target from the OMR and dropped it from the Gold Image subscription. The agent count in View 1 went down by one, and that was correct.

```bash
$OMS_HOME/bin/emcli delete_target \
    -target="ghosthost.example.com:3872" \
    -type="oracle_emd"
```

This is also a good moment to ask the team where else that decommissioned host is referenced, in monitoring scripts, in DNS, in CMDB. Stale agent registrations are usually the tip of a documentation iceberg.

**Straggler 3, an agent whose plug-in set was customized for a non-standard target type.**

This one was the interesting one. The Gold Image enforces a specific plug-in set, and this agent had an extra plug-in that the Image source did not. The fix was to add the missing plug-in to the Gold Image source agent and rebuild a new version, `V_24_1_0_8_1`, then re-run the update for that one agent. Lesson learned the hard way: every plug-in your fleet uses must be on the Gold Image source, otherwise the reconciliation fails on the one weird host with the right reason but the wrong cure.

For each straggler, before opening an SR, look at the install log on the agent host. The actual error message is in there, in every straggler I have ever debugged, the answer was in the install log on the agent host, not on the OMS:

```bash
ssh oracle@<agent_host>
tail -200 /u01/oracle/agent/agent_inst/sysman/log/gcagent.log
ls -lt /u01/oracle/agent/agent_*/sysman/log/install/
tail -200 /u01/oracle/agent/agent_*/sysman/log/install/*.out
```

When the stragglers are resolved, re-run View 1 from Step 6. A single row at `24.1.0.8.0`. The estate is one version. The series is done.

#### What Changed in My Daily Operations?

Three changes from the agent side, complementing the OMS-side changes from Article 2:

**Agent updates are now a same-week operation, not a quarter-long project.** With the OMS on RU8 and Online MOS pulling the agent software automatically, the time from "OMS upgrade complete" to "estate on the new agent RU" went from weeks to days. No more side-quest that drags into the next quarter and quietly never finishes.

**Plug-in version drift across the fleet is gone.** The Gold Image enforces a specific plug-in set, agents that drift get pulled back. The "why is this one host showing a different metric collection cadence than its peers?" diagnostics that used to eat half a day at a time, the answer was almost always plug-in version drift, are gone, because the cause is solved at the source.

**Agent-related SRs are nearly extinct.** When I worked at Oracle Support in the OEM Support Group, agent issues, agents going unreachable, agents reporting wrong target versions, agents with broken plug-ins, were a meaningful share of the SR queue every week. In a Gold-Image-managed fleet on the latest RU, the structural conditions that produced those SRs mostly do not exist anymore. Agents are still software and they will still find new ways to misbehave, but the configuration drift problems are solved at the architecture level rather than one ticket at a time.

#### Closing the Series

Three articles. Three layers. One estate.

- **Article 1:** The OMR repository database, patched from 19.28 to 19.30 with GI MRP 39168344, validated at the binary, dictionary, and connectivity levels. Foundation: correct.
- **Article 2:** The OMS, upgraded from 24.1.0.5 to 24.1.0.8 via ZDT through `omspatcher`, plus Holistic 38864999 covering WebLogic, JDK, OPatch, and FMW DB Client, plus the connectivity flip from offline to Online MOS via IDCS. Middle layer: modern.
- **Article 3:** The agents, mass-updated from 24.1.0.5 to 24.1.0.8 via the Agent Gold Image in off-peak batches, validated estate-wide via SQL and `emcli`. Edge: in sync.

The pattern Oracle is signaling with OEM 24ai is that the platform is now safe to update on the same operational rhythm as the database itself. Patch the repository on a quarterly cadence. Patch the OMS via ZDT during business hours. Push agent updates via Gold Image in batches the same week. The Saturday-night maintenance window for OEM, the one I have been booking on the team calendar since 10g, is genuinely retired.

For the readers who have been around long enough to remember `emctl start oms`, watching the console come back up with a deep breath, hoping nothing critical happened during the gap, this is a different product than the one we started with. Worth the upgrade. Worth the effort. Worth the three articles.

If you are starting your own RU5 to RU8 upgrade after reading this series, the order is OMR first, OMS second, agents third. Skip the order at your peril. Read the README, all of it. And remember that the foundation is the database, the middle is the OMS, and the edge is the agents, and a healthy estate has all three layers in lockstep.

Some old friends age well. This one did, and now the whole fleet is along for the ride.
