# Add a new club group (one click)

GitHub → Actions → **Add new group** → Run workflow.

- group_id: leave `auto` (next group, or continues an unfinished one), or type e.g. `g3`.
- confirm: `ADD GROUP` (spaces and letter case don't matter).

The run builds the group services, creates 13 services with a 200 GB photo store,
configures and reloads them, gives the group account access, runs every opening
check, opens it to new clubs and records the approval on the router. The published
app reads that approval live, so no app release is needed after a group opens.

If it stops (for example not enough fuel), the run summary says why. Fix that and
run Add new group again: finished steps are skipped and nothing is redone blindly.
Only "something changed meanwhile, nothing happened" failures retry automatically.

First run only: it upgrades the code of the shared router and account service so
they support live approvals and any-group account access (code-only upgrade).

Before the first run: publish the app once so it includes the live-approval check.

Superseded for new groups: Install new group, Configure new group, Open Group 2 to
everyone, Upgrade Group 2 (reload) and Repair Group 2 account access. They remain
for Group 2 maintenance. Stop new clubs in a group with the existing stop workflow.
