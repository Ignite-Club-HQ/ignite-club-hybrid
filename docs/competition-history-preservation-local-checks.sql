INSERT INTO clubs VALUES('10000000-0000-0000-0000-000000000001','Club');
INSERT INTO teams VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Home'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Away');
INSERT INTO competitions(id,organizer_club_id,created_by,name,status,sport,hide_scores)VALUES('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Cup','open','basketball',true);
INSERT INTO competition_roles VALUES('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','competition_admin');
INSERT INTO user_roles VALUES('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','coach'),('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','player');
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000001',false);
INSERT INTO competition_matches(id,competition_id,home_team_id,away_team_id,status,created_by)VALUES('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','scheduled','40000000-0000-0000-0000-000000000001');
INSERT INTO events(id,team_id,club_id,title,event_date,competition_match_id,competition_side)VALUES('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Game',now(),'50000000-0000-0000-0000-000000000001','home');
SELECT save_game_history('{"team_id":"20000000-0000-0000-0000-000000000001","event_id":"60000000-0000-0000-0000-000000000001","sport":"basketball","home_label":"Home","away_label":"Away","home_score":23,"away_score":17,"period_scores":[{"home":23,"away":17}],"player_stats":[{"id":"p","name":"MVP","points":23,"secondsPlayed":120}],"mvp_player_id":"p","mvp_player_name":"MVP"}',false);
DO $$BEGIN IF read_game_result('60000000-0000-0000-0000-000000000001')->>'home_score'!='23' THEN RAISE EXCEPTION 'manager score missing'; END IF;END$$;
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $$DECLARE r jsonb; BEGIN
r:=read_game_result('60000000-0000-0000-0000-000000000001');
IF r->>'home_score' IS NOT NULL OR r->>'scores_hidden'!='true' THEN RAISE EXCEPTION 'member score leak';END IF;
IF r->'player_stats'->0->>'points' IS NOT NULL OR r->'player_stats'->0->>'secondsPlayed'!='120' OR r->>'mvp_player_name'!='MVP' THEN RAISE EXCEPTION 'metadata masking incorrect';END IF;
IF EXISTS(SELECT 1 FROM game_results) THEN RAISE EXCEPTION 'raw history leak';END IF;
END$$;
RESET ROLE;
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000001',false);
DELETE FROM competition_matches WHERE id='50000000-0000-0000-0000-000000000001';
DO $$DECLARE r jsonb;BEGIN
r:=read_game_history('20000000-0000-0000-0000-000000000001',NULL,100)->0;
IF r->>'home_score'!='23' OR r->>'mvp_player_name'!='MVP' THEN RAISE EXCEPTION 'archived History lost';END IF;
END$$;
SELECT 'PASS: manager/member/raw-table/metadata/deletion preservation';
