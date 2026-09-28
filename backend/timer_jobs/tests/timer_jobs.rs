use candid::Principal;

#[test]
fn timer_job_claim_and_completion_flow() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue.grant_worker(governor, worker).unwrap();
    queue
        .schedule(governor, "timer-1", "club-1", 0, "timer-key-1")
        .unwrap();
    let claimed = queue.claim(worker, 1, 10).unwrap();
    assert_eq!(claimed[0].status, timer_jobs::Status::Processing);
    let complete = queue.complete(worker, "timer-1", "timer-key-1").unwrap();
    assert_eq!(complete.status, timer_jobs::Status::Completed);
}

#[test]
fn failed_timer_retries_before_failure() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue.grant_worker(governor, worker).unwrap();
    queue
        .schedule(governor, "timer-2", "club-1", 0, "timer-key-2")
        .unwrap();
    queue.claim(worker, 1, 10).unwrap();
    queue
        .fail(worker, "timer-2", "temporary timeout", Some(50))
        .unwrap();
    let retry = queue.claim(worker, 51, 10).unwrap();
    assert_eq!(retry[0].status, timer_jobs::Status::Processing);
}

#[test]
fn scoped_worker_only_claims_matching_timer_domain() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue
        .grant_worker_scope(governor, worker, "club-a")
        .unwrap();
    queue
        .schedule(governor, "timer-a", "club-a", 0, "key-a")
        .unwrap();
    queue
        .schedule(governor, "timer-b", "club-b", 0, "key-b")
        .unwrap();
    let claimed = queue.claim(worker, 1, 10).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].scope, "club-a");
}

#[test]
fn timer_worker_scope_must_not_be_empty() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    assert!(queue.grant_worker_scope(governor, worker, " ").is_err());
}

#[test]
fn callback_jobs_require_approved_callback_scope() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let callback = Principal::from_slice(&[3u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue
        .grant_worker_scope(governor, worker, "club-a")
        .unwrap();
    assert!(queue
        .schedule_with_callback(
            governor,
            "timer-denied",
            "club-a",
            Some(callback),
            0,
            "key-denied"
        )
        .is_err());
    queue
        .grant_callback_scope(governor, callback, "club-a")
        .unwrap();
    queue
        .schedule_with_callback(
            governor,
            "timer-approved",
            "club-a",
            Some(callback),
            0,
            "key-approved",
        )
        .unwrap();
    let claimed = queue.claim(worker, 1, 10).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].callback, Some(callback));
}

#[test]
fn callback_scope_cannot_cross_timer_domain() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let callback = Principal::from_slice(&[3u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue.grant_worker(governor, worker).unwrap();
    queue
        .grant_callback_scope(governor, callback, "club-a")
        .unwrap();
    queue
        .schedule_with_callback(
            governor,
            "timer-cross",
            "club-b",
            Some(callback),
            0,
            "key-cross",
        )
        .unwrap_err();
}

#[test]
fn expired_timer_lease_is_recovered_and_retry_budget_dead_letters() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue.grant_worker(governor, worker).unwrap();
    queue
        .schedule(governor, "timer-lease", "club-a", 0, "key-lease")
        .unwrap();
    let first = queue.claim_with_lease(worker, 10, 1, 5).unwrap();
    assert_eq!(first[0].lease_until_ms, Some(15));
    assert_eq!(queue.recover_expired(worker, 15).unwrap(), 1);
    assert_eq!(
        queue.claim_with_lease(worker, 20, 1, 5).unwrap()[0].attempts,
        2
    );
    queue.recover_expired(worker, 25).unwrap();
    queue.claim_with_lease(worker, 30, 1, 5).unwrap();
    queue.recover_expired(worker, 35).unwrap();
    queue.claim_with_lease(worker, 40, 1, 5).unwrap();
    assert_eq!(queue.recover_expired(worker, 45).unwrap(), 1);
    queue.claim_with_lease(worker, 50, 1, 5).unwrap();
    assert_eq!(queue.recover_expired(worker, 55).unwrap(), 1);
    let dead_letter = queue.get("timer-lease").unwrap();
    assert_eq!(dead_letter.status, timer_jobs::Status::Failed);
    assert_eq!(
        dead_letter.last_error.as_deref(),
        Some("Timer lease exhausted")
    );
}

#[test]
fn zero_lease_and_empty_claims_fail_closed() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let worker = Principal::from_slice(&[2u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue.grant_worker(governor, worker).unwrap();
    assert!(queue.claim_with_lease(worker, 0, 0, 1).is_err());
    assert!(queue.claim_with_lease(worker, 0, 1, 0).is_err());
}

#[test]
fn callback_workflow_schedule_is_idempotent_by_job_id() {
    let governor = Principal::from_slice(&[1u8; 29]);
    let callback = Principal::from_slice(&[3u8; 29]);
    let mut queue = timer_jobs::TimerQueue::new(governor);
    queue
        .grant_callback_scope(governor, callback, "club-a")
        .unwrap();
    let first = queue
        .schedule_with_callback(
            governor,
            "workflow-1",
            "club-a",
            Some(callback),
            100,
            "key-1",
        )
        .unwrap();
    let repeated = queue
        .schedule_with_callback(
            governor,
            "workflow-1",
            "club-a",
            Some(callback),
            200,
            "key-2",
        )
        .unwrap();
    assert_eq!(first, repeated);
}
