"""Run the actual quota migrations on an isolated temporary PostgreSQL cluster.

No production credentials, accounts or Storage writes are used.
"""
import pathlib
import subprocess
import tempfile
import unittest
import os
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLUB = "11111111-1111-4111-8111-111111111111"
TEAM = "22222222-2222-4222-8222-222222222222"
USER = "33333333-3333-4333-8333-333333333333"


class MeasuredMediaSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="ignite-media-pg-")
        cls.path = pathlib.Path(cls.tmp.name)
        cls.prefix = ["runuser", "-u", "nobody", "--"] if os.geteuid() == 0 else []
        if cls.prefix:
            os.chown(cls.path, 65534, 65534)
        subprocess.run(cls.prefix + ["initdb", "-D", str(cls.path / "db"), "-A", "trust", "--no-locale"], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(cls.prefix + ["pg_ctl", "-D", str(cls.path / "db"), "-l", str(cls.path / "server.log"), "-o", f"-k {cls.path} -h '' -p 15433", "-w", "start"], check=True, stdout=subprocess.DEVNULL)
        cls.sql("""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE TABLE public.clubs(id uuid PRIMARY KEY);
CREATE TABLE public.teams(id uuid PRIMARY KEY,club_id uuid,deleted_at timestamptz);
CREATE TABLE public.club_subscriptions(club_id uuid,plan text,pricing_version text,is_pro boolean,is_pro_football boolean,admin_pro_override boolean,admin_pro_football_override boolean,expires_at timestamptz,is_trial boolean,trial_ends_at timestamptz,storage_purchased_gb integer);
CREATE TABLE public.team_subscriptions(team_id uuid,is_pro boolean,is_pro_football boolean,admin_pro_override boolean,admin_pro_football_override boolean,expires_at timestamptz,is_trial boolean,trial_ends_at timestamptz);
CREATE TABLE public.user_roles(user_id uuid,club_id uuid,team_id uuid,role text);
CREATE TABLE public.mini_leagues(id uuid,club_id uuid);
CREATE TABLE public.mini_league_admins(mini_league_id uuid,user_id uuid);
CREATE TABLE public.competitions(id uuid,organizer_club_id uuid);
CREATE TABLE public.test_competition_staff(user_id uuid,competition_id uuid);
CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.has_role(u uuid,r text,c uuid DEFAULT NULL,t uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role=r AND (c IS NULL OR club_id=c) AND (t IS NULL OR team_id=t)) $$;
CREATE FUNCTION public.is_club_member(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND club_id=c) $$;
CREATE FUNCTION public.is_team_member(u uuid,t uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND team_id=t) $$;
CREATE FUNCTION public.can_manage_competition_vault(c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.test_competition_staff WHERE user_id=auth.uid() AND competition_id=c) $$;
""")
        # Exact applied source, not a rewritten model of the business rules.
        for stamp in ["20261022041723", "20261022041801", "20261022042440", "20261022042733", "20261022042939"]:
            files = list((ROOT / "supabase/migrations").glob(stamp + "_*.sql"))
            if len(files) != 1:
                raise RuntimeError("Expected exactly one migration: " + stamp)
            cls.sql(files[0].read_text())

    @classmethod
    def tearDownClass(cls):
        subprocess.run(cls.prefix + ["pg_ctl", "-D", str(cls.path / "db"), "-m", "immediate", "-w", "stop"], check=True, stdout=subprocess.DEVNULL)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, text, ok=True):
        result = subprocess.run(["psql", "-X", "-h", str(cls.path), "-p", "15433", "-U", "nobody" if cls.prefix else os.environ.get("USER", "postgres"), "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], input=text, text=True, capture_output=True)
        if ok and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def setUp(self):
        self.sql(f"""TRUNCATE public.clubs,public.teams,public.user_roles,public.club_subscriptions,public.team_subscriptions,public.media_upload_reservations,storage.objects,public.competitions,public.test_competition_staff;
INSERT INTO public.clubs VALUES('{CLUB}');
INSERT INTO public.teams VALUES('{TEAM}','{CLUB}',NULL);
INSERT INTO public.user_roles VALUES('{USER}','{CLUB}',NULL,'club_admin');
""")

    def reserve(self, path="one.jpg", size=1, team="NULL", vault="false", ok=True):
        return self.sql(f"SELECT public.reserve_measured_media('{USER}','{CLUB}',{team},'photos','clubs/{CLUB}/{path}',{size},{vault});", ok=ok)

    def test_free_250_mib_includes_pending_uploads(self):
        self.sql(f"INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/old.jpg','{{\"size\":262143998}}');")
        self.reserve(size=2)
        denied = self.reserve("two.jpg", size=1, ok=False)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn("Storage allowance full", denied.stderr)

    def test_single_team_1_gib_isolated_from_other_files(self):
        self.sql(f"INSERT INTO public.team_subscriptions(team_id,is_pro) VALUES('{TEAM}',true); INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/old.jpg','{{\"size\":4294967296}}'),('photos','clubs/{CLUB}/teams/{TEAM}/old.jpg','{{\"size\":1073741823}}');")
        self.reserve(f"teams/{TEAM}/one.jpg", team=f"'{TEAM}'", size=1)
        self.assertNotEqual(self.reserve(f"teams/{TEAM}/two.jpg", team=f"'{TEAM}'", size=1, ok=False).returncode, 0)

    def test_legacy_and_new_paid_allowances(self):
        self.sql(f"INSERT INTO public.club_subscriptions(club_id,plan,is_pro,pricing_version) VALUES('{CLUB}','starter',true,'legacy');")
        self.assertEqual(self.sql(f"SELECT limit_bytes FROM public.subscription_media_allowance('{CLUB}',NULL);").stdout.strip(), "5368709120")
        self.sql("UPDATE public.club_subscriptions SET pricing_version='usd_v2';")
        self.assertEqual(self.sql(f"SELECT limit_bytes FROM public.subscription_media_allowance('{CLUB}',NULL);").stdout.strip(), "3221225472")
        self.sql("UPDATE public.club_subscriptions SET plan='unlimited',pricing_version='legacy';")
        self.assertEqual(self.sql(f"SELECT limit_bytes FROM public.subscription_media_allowance('{CLUB}',NULL);").stdout.strip(), "5368709120")

    def test_null_size_cannot_bypass_quota(self):
        self.assertNotEqual(self.reserve(size="NULL", ok=False).returncode, 0)

    def test_concurrent_devices_cannot_overbook_free_storage(self):
        self.sql(f"INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/old.jpg','{{\"size\":262143999}}');")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda path: self.reserve(path, size=1, ok=False), ["device-a.jpg", "device-b.jpg"]))
        self.assertEqual(sum(result.returncode == 0 for result in results), 1)
        self.assertEqual(self.sql("SELECT count(*) FROM public.media_upload_reservations WHERE state='pending';").stdout.strip(), "1")

    def test_revoked_team_staff_cannot_upload_vault(self):
        self.sql(f"DELETE FROM public.user_roles WHERE user_id='{USER}'; INSERT INTO public.user_roles VALUES('{USER}','{CLUB}','{TEAM}','player');")
        self.assertNotEqual(self.reserve(f"teams/{TEAM}/one.jpg", team=f"'{TEAM}'", vault="true", ok=False).returncode, 0)

    def test_expired_subscription_does_not_delete_existing_files(self):
        self.sql(f"INSERT INTO public.club_subscriptions(club_id,plan,is_pro,pricing_version,expires_at) VALUES('{CLUB}','starter',true,'usd_v2',now()-interval '1 day'); INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/old.jpg','{{\"size\":3221225472}}');")
        self.assertNotEqual(self.reserve(ok=False).returncode, 0)
        self.assertEqual(self.sql("SELECT count(*) FROM storage.objects;").stdout.strip(), "1")

    def test_finalize_rechecks_changed_entitlement(self):
        self.sql(f"INSERT INTO public.club_subscriptions(club_id,plan,is_pro,pricing_version) VALUES('{CLUB}','starter',true,'usd_v2'); INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/old.jpg','{{\"size\":262144000}}');")
        token = self.reserve(size=2).stdout.strip()
        self.sql(f"UPDATE public.club_subscriptions SET expires_at=now()-interval '1 day'; INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/one.jpg','{{\"size\":2}}');")
        self.assertNotEqual(self.sql(f"SELECT public.settle_measured_media('{token}',true);", ok=False).returncode, 0)
        self.assertEqual(self.sql("SELECT count(*) FROM storage.objects;").stdout.strip(), "2")

    def test_wrong_team_path_denied(self):
        self.assertNotEqual(self.reserve("other.jpg", team=f"'{TEAM}'", ok=False).returncode, 0)

    def test_competition_requires_exact_staff(self):
        competition = "44444444-4444-4444-8444-444444444444"
        self.sql(f"INSERT INTO public.competitions VALUES('{competition}','{CLUB}');")
        self.assertNotEqual(self.reserve(f"competitions/{competition}/one.jpg", vault="true", ok=False).returncode, 0)
        self.sql(f"INSERT INTO public.test_competition_staff VALUES('{USER}','{competition}');")
        self.reserve(f"competitions/{competition}/one.jpg", vault="true")

    def test_confirmed_object_is_not_double_counted(self):
        token = self.reserve(size=2).stdout.strip()
        self.sql(f"INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/one.jpg','{{\"size\":2}}'),('photos','clubs/{CLUB}/old.jpg','{{\"size\":262143997}}');")
        self.reserve("two.jpg", size=1)
        self.sql(f"SELECT public.settle_measured_media('{token}',true);")

    def test_confirmation_cannot_release_existing_file(self):
        token = self.reserve(size=2).stdout.strip()
        self.sql(f"INSERT INTO storage.objects VALUES('photos','clubs/{CLUB}/one.jpg','{{\"size\":2}}');")
        self.assertNotEqual(self.sql(f"SELECT public.settle_measured_media('{token}',false);",ok=False).returncode, 0)
        self.assertEqual(self.sql(f"SELECT state FROM public.media_upload_reservations WHERE id='{token}';").stdout.strip(), "pending")

    def test_browser_cannot_call_privileged_reservations(self):
        for role in ["anon", "authenticated"]:
            self.assertEqual(self.sql(f"SELECT has_function_privilege('{role}','public.reserve_measured_media(uuid,uuid,uuid,text,text,bigint,boolean)','EXECUTE');").stdout.strip(), "f")


if __name__ == "__main__":
    unittest.main()