# Releasing the permanent club lookup

One protected GitHub run upgrades the account service and both groups' club
services, fills the lookup with every existing membership, verifies it, and
records readiness. It does **not** switch the app to the lookup — that is a
separate explicit step after readiness is recorded.

## Before you run

- Use a computer browser (the GitHub phone app may not list a workflow that
  has never run).
- The run needs the existing `DEPLOYER_PEM` GitHub secret; no new secrets.

## The single run

1. Open the repository on GitHub → **Actions** → **Release permanent club
   lookup (both ICP groups)**.
2. Click **Run workflow**, choose **upgrade**.
3. Type exactly: `RELEASE MEMBERSHIP LOOKUP`
4. Click the green **Run workflow** button and approve if GitHub asks.

A **check** run (no confirmation) only verifies the live services match what
the release expects and changes nothing.

## What the run does

- Upgrades only three existing services: the shared account service
  (`identity_access`) and each group's club service (`club_domain`). No other
  service is touched, created or rewired.
- Fills the lookup from both groups' existing memberships, resuming from a
  saved position if interrupted — re-running after a failure carries on; it
  never starts over or duplicates work.
- Verifies the filled lookup against the live services before recording
  readiness. If verification fails, nothing is recorded and the app keeps
  using today's club search.

## Success

- The run ends with a green tick and commits a readiness record
  (`deploy/groups/g2/membership-lookup-readiness.json`).
- Members see no change yet: the app keeps using today's club discovery until
  the lookup is explicitly enabled in a later app release.

## If it fails

- Send a screenshot of the failed step. Re-running the same workflow resumes
  safely; it refuses to guess about any step whose outcome is unknown.
- A red run never leaves the app without club discovery — the current search
  stays active throughout.
