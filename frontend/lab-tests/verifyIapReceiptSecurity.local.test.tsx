/**
 * Local equivalent of the exported `verifyIapReceipt.security.test.ts`
 * suite: source-level security acceptance checks for the `verify-iap-receipt`
 * Edge Function, read as inert text from the sanitized reference sources
 * (the function itself and the concatenated reference migrations).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function extractSanitizedSource(mdText: string): string {
  const lines = mdText.split('\n');
  const openIndex = lines.findIndex((line) => /^`{4,}/.test(line));
  if (openIndex === -1) return '';
  const closeIndex = lines.findIndex(
    (line, index) => index > openIndex && /^`{4,}\s*$/.test(line),
  );
  if (closeIndex === -1) return '';
  return lines.slice(openIndex + 1, closeIndex).join('\n');
}

const functionsRoot = path.resolve(__dirname, '../../reference/backend/supabase/functions');
const migrationsRoot = path.resolve(__dirname, '../../reference/backend/supabase/migrations');

const edgeFunctionSource = extractSanitizedSource(
  readFileSync(path.join(functionsRoot, 'verify-iap-receipt/index.ts.md'), 'utf8'),
);
const migrationSource = existsSync(migrationsRoot)
  ? readdirSync(migrationsRoot)
      .filter((file) => file.endsWith('.sql.md'))
      .map((file) => extractSanitizedSource(readFileSync(path.join(migrationsRoot, file), 'utf8')))
      .join('\n')
  : '';

const directEntitlementMutation = new RegExp(
  String.raw`\.from\(\s*["'](?:iap_transactions|club_subscriptions|team_subscriptions|clubs)["']\s*\)[\s\S]{0,500}?\.(?:insert|update|upsert|delete)\s*\(`,
  'g',
);

describe('verify-iap-receipt security acceptance', () => {
  it('does not trust a client-supplied transaction or receipt', () => {
    expect(edgeFunctionSource).not.toMatch(/trust the client(?:-side)? transaction/i);
    expect(edgeFunctionSource).not.toMatch(/TODO:\s*Add proper receipt validation/i);
  });

  it('verifies Apple and Google purchases with their server-side APIs', () => {
    const hasAppleVerification =
      /verifyApple(?:Purchase|Transaction|Receipt)/i.test(edgeFunctionSource) ||
      /AppStoreServerAPIClient/.test(edgeFunctionSource) ||
      /api\.storekit(?:-sandbox)?\.itunes\.apple\.com/.test(edgeFunctionSource);
    const hasGoogleVerification =
      /verifyGoogle(?:Purchase|Transaction|Receipt)/i.test(edgeFunctionSource) ||
      /androidpublisher\.googleapis\.com/.test(edgeFunctionSource) ||
      /purchases\.subscriptionsv2\.get/.test(edgeFunctionSource);

    expect(hasAppleVerification, 'Missing Apple server-side purchase verification').toBe(true);
    expect(hasGoogleVerification, 'Missing Google server-side purchase verification').toBe(true);
  });

  it('uses the verified store result—not request fields—to authorize the product', () => {
    expect(edgeFunctionSource).toMatch(
      /verified\.(?:productId|product_id)\s*!==\s*product\.(?:productId|product_id)/i,
    );
    expect(edgeFunctionSource).toMatch(/payload\.entityType\s*!==\s*product\.entityType/i);
  });

  it('fails closed when store verification fails or cannot run', () => {
    expect(edgeFunctionSource).toMatch(
      /catch\s*\([^)]*\)\s*\{[\s\S]{0,1200}?return\s+json\([^;]+,\s*(?:400|401|403|404|409|422|500|502|503|err\.httpStatus)\s*\)/i,
    );
    expect(edgeFunctionSource).not.toMatch(
      /catch\s*\([^)]*\)\s*\{[\s\S]{0,500}?(?:apply_verified_iap_purchase|iap_transactions|club_subscriptions|team_subscriptions)/i,
    );
  });

  it('applies transaction recording and entitlement changes through one atomic RPC', () => {
    expect(edgeFunctionSource).toMatch(/\.rpc\(\s*["']apply_verified_iap_purchase["']/);
    expect(edgeFunctionSource.match(directEntitlementMutation) ?? []).toHaveLength(0);
  });

  it('defines the atomic purchase RPC with a hardened execution context', () => {
    expect(migrationSource).toMatch(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?apply_verified_iap_purchase\b/i,
    );
    expect(migrationSource).toMatch(
      /apply_verified_iap_purchase[\s\S]{0,8000}?security\s+definer/i,
    );
    expect(migrationSource).toMatch(
      /apply_verified_iap_purchase[\s\S]{0,8000}?set\s+search_path\s*=\s*(?:public\s*,\s*)?pg_temp/i,
    );
  });

  it('enforces purchase replay protection in the database', () => {
    const hasReplayConstraint =
      /unique\s*\([^)]*(?:transaction_id|purchase_token)[^)]*\)/i.test(migrationSource) ||
      /create\s+unique\s+index[\s\S]{0,500}?(?:transaction_id|purchase_token)/i.test(
        migrationSource,
      );
    expect(hasReplayConstraint, 'Missing database-enforced transaction replay protection').toBe(
      true,
    );
  });

  it('does not expose the service-role purchase RPC to app clients', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(migrationSource).toMatch(
        new RegExp(
          String.raw`revoke\s+(?:all|execute)\s+on\s+function\s+(?:public\.)?apply_verified_iap_purchase\s*\(\s*jsonb\s*\)\s+from\s+${role}\b`,
          'i',
        ),
      );
    }
    expect(migrationSource).toMatch(
      /grant\s+execute\s+on\s+function\s+(?:public\.)?apply_verified_iap_purchase\s*\(\s*jsonb\s*\)\s+to\s+service_role\b/i,
    );
  });
});
