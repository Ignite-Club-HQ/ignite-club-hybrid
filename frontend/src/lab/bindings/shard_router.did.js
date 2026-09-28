/* eslint-disable */
// Local synthetic shard-router declaration. Regenerate from backend/shard_router/shard_router.did
// if the Candid contract changes; this module is intentionally outside the lab runtime allowlist.
// @ts-nocheck
import { IDL } from '@icp-sdk/core/candid';

export const idlFactory = ({ IDL }) => {
  const Route = IDL.Record({ club_id: IDL.Text, revision: IDL.Nat64, shard: IDL.Principal });
  const Page = IDL.Record({ next: IDL.Opt(IDL.Text), revision: IDL.Nat64, routes: IDL.Vec(Route) });
  const ResultRoute = IDL.Variant({ Ok: IDL.Opt(Route), Err: IDL.Text });
  const ResultPage = IDL.Variant({ Ok: Page, Err: IDL.Text });
  const Migration = IDL.Record({ club_id: IDL.Text, destination: IDL.Principal, migration_revision: IDL.Nat64, route_revision: IDL.Nat64, source: IDL.Principal });
  const ResultMigration = IDL.Variant({ Ok: Migration, Err: IDL.Text });
  const ResultMigrationOpt = IDL.Variant({ Ok: IDL.Opt(Migration), Err: IDL.Text });
  const ResultNat = IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text });
  const ResultAssign = IDL.Variant({ Ok: IDL.Record({ revision: IDL.Nat64, route: Route }), Err: IDL.Text });
  const AssignRequest = IDL.Record({ club_id: IDL.Text, shard: IDL.Principal, expected_revision: IDL.Nat64 });
  return IDL.Service({
    abort_migration: IDL.Func([IDL.Text, IDL.Nat64], [ResultNat], []),
    assign: IDL.Func([AssignRequest], [ResultAssign], []),
    begin_migration: IDL.Func([IDL.Text, IDL.Principal, IDL.Nat64], [ResultMigration], []),
    commit_migration: IDL.Func([IDL.Text, IDL.Nat64], [ResultAssign], []),
    get_route: IDL.Func([IDL.Text], [ResultRoute], ['query']),
    get_migration: IDL.Func([IDL.Text], [ResultMigrationOpt], ['query']),
    list_routes: IDL.Func([IDL.Opt(IDL.Text), IDL.Nat16], [ResultPage], ['query']),
    version: IDL.Func([], [IDL.Nat64], ['query']),
  });
};

export const routerTypes = { IDL };
