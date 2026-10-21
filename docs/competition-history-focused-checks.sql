-- Disposable PostgreSQL fixture only. Never apply test rows to production.
BEGIN;
INSERT INTO clubs(id,name) VALUES('10000000-0000-0000-0000-000000000001','Test club');
INSERT INTO teams(id,club_id,name,created_by) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Home','40000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Away','40000000-0000-0000-0000-000000000001');
INSERT INTO competitions(id,organizer_club_id,created_by,name,status,sport,hide_scores) VALUES('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Cup','active','basketball',true);
INSERT INTO competition_roles(user_id,competition_id,role) VALUES('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','owner');
INSERT INTO user_roles(user_id,club_id,team_id,role) VALUES('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','coach'),('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','player');
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000001',true);
INSERT INTO competition_matches(id,competition_id,home_team_id,away_team_id,status,created_by,scheduled_at) VALUES('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','scheduled','40000000-0000-0000-0000-000000000001',now());
DO $$DECLARE ev uuid;BEGIN
 SELECT home_event_id INTO ev FROM competition_matches WHERE id='50000000-0000-0000-0000-000000000001';
 IF ev IS NULL OR (SELECT count(*) FROM events WHERE competition_match_id='50000000-0000-0000-0000-000000000001')!=2 THEN RAISE EXCEPTION 'Exact two fixture events required';END IF;
 PERFORM save_game_history(jsonb_build_object('team_id','20000000-0000-0000-0000-000000000001','event_id',ev,'sport','basketball','home_label','Home','away_label','Away','home_score',23,'away_score',17,'period_scores','[{"home":23,"away":17}]'::jsonb,'player_stats','[{"id":"p","name":"MVP","points":23,"secondsPlayed":120}]'::jsonb,'mvp_player_id','p','mvp_player_name','MVP'),false);
 IF read_game_result(ev)->>'home_score'!='23' THEN RAISE EXCEPTION 'Manager score missing';END IF;
 INSERT INTO game_player_stats(event_id,team_id,minutes_played,goals_scored,assists) VALUES(ev,'20000000-0000-0000-0000-000000000001',12,23,4);
 INSERT INTO game_summaries(event_id,team_id,pitch_state,timer_state,total_game_time) VALUES(ev,'20000000-0000-0000-0000-000000000001','{}','{}',720);
END $$;
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$DECLARE r jsonb;s jsonb;ev uuid;BEGIN
 SELECT home_event_id INTO ev FROM competition_matches WHERE id='50000000-0000-0000-0000-000000000001';
 r:=read_game_result(ev);
 IF r IS NULL OR r->>'home_score' IS NOT NULL OR r->>'scores_hidden'!='true' THEN RAISE EXCEPTION 'Member score leak';END IF;
 IF r->'player_stats'->0->>'points' IS NOT NULL OR r->'player_stats'->0->>'secondsPlayed'!='120' OR r->>'mvp_player_name'!='MVP' THEN RAISE EXCEPTION 'Non-score detail lost';END IF;
 s:=read_history_player_stats('20000000-0000-0000-0000-000000000001',ev,NULL,NULL)->0;
 IF s->>'goals_scored' IS NOT NULL OR s->>'assists' IS NOT NULL OR s->>'minutes_played'!='12' THEN RAISE EXCEPTION 'Report privacy incorrect';END IF;
 IF EXISTS(SELECT 1 FROM game_results) OR EXISTS(SELECT 1 FROM game_player_stats) THEN RAISE EXCEPTION 'Raw score leak';END IF;
 BEGIN PERFORM save_competition_match_result('50000000-0000-0000-0000-000000000001',99,99,'completed');RAISE EXCEPTION 'Member write allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$BEGIN IF read_game_history('20000000-0000-0000-0000-000000000001',NULL,100)!='[]'::jsonb THEN RAISE EXCEPTION 'Outsider History leak';END IF;END $$;
RESET ROLE;
SELECT set_config('request.test_uid','40000000-0000-0000-0000-000000000001',true);
DELETE FROM competition_matches WHERE id='50000000-0000-0000-0000-000000000001';
DO $$DECLARE r jsonb;s jsonb;BEGIN
 r:=read_game_history('20000000-0000-0000-0000-000000000001',NULL,100)->0;
 IF r->>'home_score'!='23' OR r->>'mvp_player_name'!='MVP' THEN RAISE EXCEPTION 'Archived History lost';END IF;
 s:=read_history_player_stats('20000000-0000-0000-0000-000000000001',NULL,NULL,NULL)->0;
 IF s->>'minutes_played'!='12' OR s->>'assists'!='4' THEN RAISE EXCEPTION 'Archived player report lost';END IF;
 IF (SELECT count(*) FROM game_summaries)!=1 THEN RAISE EXCEPTION 'Archived summary lost';END IF;
END $$;
SELECT 'PASS: exact fixtures, manager/member/outsider, goals/assists masking, canonical save and archived reports';
ROLLBACK;