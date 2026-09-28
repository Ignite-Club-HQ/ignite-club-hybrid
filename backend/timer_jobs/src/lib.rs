//! Disposable ICP proof for durable scheduled-job state.
//! The queue is synthetic and does not call external providers.
use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableCell,
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum Status {
    Pending,
    Processing,
    Completed,
    Failed,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Job {
    pub id: String,
    pub scope: String,
    pub callback: Option<Principal>,
    pub run_at_ms: u64,
    pub lease_until_ms: Option<u64>,
    pub idempotency_key: String,
    pub status: Status,
    pub attempts: u32,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkerCapability {
    pub worker: Principal,
    pub scope: String,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct CallbackCapability {
    pub callback: Principal,
    pub scope: String,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct TimerQueue {
    governor: Principal,
    workers: Vec<WorkerCapability>,
    callbacks: Vec<CallbackCapability>,
    jobs: Vec<Job>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum JobStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueueState {
    pub armed: bool,
    pub next_run_at_ms: Option<u64>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot {
    pub jobs: Vec<Job>,
    pub state: QueueState,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reconciliation {
    pub local_jobs: u32,
    pub incoming_jobs: u32,
    pub matching_jobs: u32,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub jobs: Vec<Job>,
    pub next: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedState {
    queue: Option<TimerQueue>,
    state: QueueState,
}

type Outcome<T> = Result<T, String>;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static STABLE_STATE: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(0), Vec::new()));
    static CANISTER_QUEUE: RefCell<Option<TimerQueue>> = const { RefCell::new(None) };
    static CANISTER_STATE: RefCell<QueueState> = const { RefCell::new(QueueState { armed: false, next_run_at_ms: None }) };
}

fn memory(id: u8) -> Memory {
    MEMORY_MANAGER.with(|manager| manager.borrow().get(MemoryId::new(id)))
}
fn encode_state(value: &PersistedState) -> Vec<u8> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes).expect("timer state encode");
    bytes
}
fn decode_state(bytes: &[u8]) -> PersistedState {
    ciborium::from_reader(bytes).expect("timer state decode")
}
fn persisted_state() -> PersistedState {
    STABLE_STATE.with(|stable| {
        let bytes = stable.borrow().get().clone();
        if bytes.is_empty() {
            PersistedState {
                queue: None,
                state: QueueState {
                    armed: false,
                    next_run_at_ms: None,
                },
            }
        } else {
            decode_state(&bytes)
        }
    })
}
fn save_persisted_state(value: PersistedState) {
    STABLE_STATE.with(|stable| stable.borrow_mut().set(encode_state(&value)));
}
fn queue_state() -> QueueState {
    CANISTER_STATE.with(|state| state.borrow().clone())
}
fn save_queue_state(state: QueueState) {
    CANISTER_STATE.with(|current| *current.borrow_mut() = state.clone());
    let mut persisted = persisted_state();
    persisted.state = state;
    save_persisted_state(persisted);
}
fn canister_queue() -> TimerQueue {
    CANISTER_QUEUE.with(|queue| {
        queue
            .borrow()
            .clone()
            .or_else(|| persisted_state().queue)
            .expect("timer queue is not initialized")
    })
}
fn save_canister_queue(queue: TimerQueue) {
    CANISTER_QUEUE.with(|current| *current.borrow_mut() = Some(queue.clone()));
    let mut persisted = persisted_state();
    persisted.queue = Some(queue);
    save_persisted_state(persisted);
}
fn caller() -> Principal {
    ic_cdk::api::msg_caller()
}
fn authenticated() -> Outcome<()> {
    if caller() == Principal::anonymous() {
        Err("Authenticated user required".into())
    } else {
        Ok(())
    }
}

impl TimerQueue {
    pub fn new(governor: Principal) -> Self {
        Self {
            governor,
            workers: vec![],
            callbacks: vec![],
            jobs: vec![],
        }
    }

    pub fn grant_worker(&mut self, actor: Principal, worker: Principal) -> Result<(), String> {
        self.grant_worker_scope(actor, worker, "*")
    }

    pub fn grant_worker_scope(
        &mut self,
        actor: Principal,
        worker: Principal,
        scope: &str,
    ) -> Result<(), String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated caller required".into());
        }
        if actor != self.governor {
            return Err("Governor required".into());
        }
        if worker == Principal::anonymous() {
            return Err("Invalid worker".into());
        }
        if scope.trim().is_empty() {
            return Err("Invalid worker scope".into());
        }
        if !self
            .workers
            .iter()
            .any(|capability| capability.worker == worker && capability.scope == scope)
        {
            self.workers.push(WorkerCapability {
                worker,
                scope: scope.to_string(),
            });
        }
        Ok(())
    }

    pub fn grant_callback_scope(
        &mut self,
        actor: Principal,
        callback: Principal,
        scope: &str,
    ) -> Result<(), String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated caller required".into());
        }
        if actor != self.governor {
            return Err("Governor required".into());
        }
        if callback == Principal::anonymous() {
            return Err("Invalid callback".into());
        }
        if scope.trim().is_empty() {
            return Err("Invalid callback scope".into());
        }
        if !self
            .callbacks
            .iter()
            .any(|capability| capability.callback == callback && capability.scope == scope)
        {
            self.callbacks.push(CallbackCapability {
                callback,
                scope: scope.to_string(),
            });
        }
        Ok(())
    }

    pub fn schedule(
        &mut self,
        actor: Principal,
        id: &str,
        scope: &str,
        run_at_ms: u64,
        idempotency_key: &str,
    ) -> Result<Job, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated caller required".into());
        }
        self.schedule_with_callback(actor, id, scope, None, run_at_ms, idempotency_key)
    }

    pub fn schedule_with_callback(
        &mut self,
        actor: Principal,
        id: &str,
        scope: &str,
        callback: Option<Principal>,
        run_at_ms: u64,
        idempotency_key: &str,
    ) -> Result<Job, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated user required".into());
        }
        if let Some(existing) = self.jobs.iter().find(|job| job.id == id) {
            return Ok(existing.clone());
        }
        if scope.trim().is_empty() || id.trim().is_empty() || idempotency_key.trim().is_empty() {
            return Err("Invalid timer fields".into());
        }
        if let Some(callback_principal) = callback {
            if !self.callbacks.iter().any(|capability| {
                capability.callback == callback_principal
                    && (capability.scope == scope || capability.scope == "*")
            }) {
                return Err("Callback capability required".into());
            }
        }
        let job = Job {
            id: id.to_string(),
            scope: scope.to_string(),
            callback,
            run_at_ms,
            lease_until_ms: None,
            idempotency_key: idempotency_key.to_string(),
            status: Status::Pending,
            attempts: 0,
            last_error: None,
        };
        self.jobs.push(job.clone());
        Ok(job)
    }

    pub fn claim(
        &mut self,
        actor: Principal,
        now_ms: u64,
        limit: usize,
    ) -> Result<Vec<Job>, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated caller required".into());
        }
        if actor != self.governor
            && !self
                .workers
                .iter()
                .any(|capability| capability.worker == actor)
        {
            return Err("Worker capability required".into());
        }
        self.claim_with_lease(actor, now_ms, limit, 60_000)
    }

    pub fn claim_with_lease(
        &mut self,
        actor: Principal,
        now_ms: u64,
        limit: usize,
        lease_ms: u64,
    ) -> Result<Vec<Job>, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated user required".into());
        }
        if limit == 0 || lease_ms == 0 {
            return Err("Invalid claim bounds".into());
        }
        if actor != self.governor
            && !self
                .workers
                .iter()
                .any(|capability| capability.worker == actor)
        {
            return Err("Worker capability required".into());
        }
        let governor = self.governor;
        let workers = self.workers.clone();
        let callbacks = self.callbacks.clone();
        let mut claimed = Vec::new();
        for job in self.jobs.iter_mut() {
            if claimed.len() >= limit {
                break;
            }
            let scope_allowed = actor == governor
                || workers.iter().any(|capability| {
                    capability.worker == actor
                        && (capability.scope == "*" || capability.scope == job.scope)
                });
            let callback_allowed = job.callback.is_none()
                || callbacks.iter().any(|capability| {
                    Some(capability.callback) == job.callback
                        && (capability.scope == job.scope || capability.scope == "*")
                });
            if job.status == Status::Pending
                && job.run_at_ms <= now_ms
                && job.attempts < 5
                && scope_allowed
                && callback_allowed
            {
                job.status = Status::Processing;
                job.attempts += 1;
                job.lease_until_ms = Some(now_ms.saturating_add(lease_ms));
                claimed.push(job.clone());
            }
        }
        Ok(claimed)
    }

    pub fn complete(
        &mut self,
        actor: Principal,
        id: &str,
        expected_key: &str,
    ) -> Result<Job, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated caller required".into());
        }
        if actor != self.governor
            && !self
                .workers
                .iter()
                .any(|capability| capability.worker == actor)
        {
            return Err("Worker capability required".into());
        }
        let index = self
            .jobs
            .iter()
            .position(|job| job.id == id)
            .ok_or("Unknown job")?;
        if self.jobs[index].idempotency_key != expected_key {
            return Err("Idempotency key mismatch".into());
        }
        if self.jobs[index].status == Status::Completed {
            return Ok(self.jobs[index].clone());
        }
        if self.jobs[index].status != Status::Processing {
            return Err("Job is not processing".into());
        }
        self.jobs[index].status = Status::Completed;
        self.jobs[index].lease_until_ms = None;
        Ok(self.jobs[index].clone())
    }

    pub fn fail(
        &mut self,
        actor: Principal,
        id: &str,
        error: &str,
        retry_at_ms: Option<u64>,
    ) -> Result<Job, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated caller required".into());
        }
        if actor != self.governor
            && !self
                .workers
                .iter()
                .any(|capability| capability.worker == actor)
        {
            return Err("Worker capability required".into());
        }
        let index = self
            .jobs
            .iter()
            .position(|job| job.id == id)
            .ok_or("Unknown job")?;
        if self.jobs[index].status != Status::Processing {
            return Err("Job is not processing".into());
        }
        self.jobs[index].last_error = Some(error.to_string());
        self.jobs[index].status = if retry_at_ms.is_some() && self.jobs[index].attempts < 5 {
            Status::Pending
        } else {
            Status::Failed
        };
        if let Some(run_at_ms) = retry_at_ms {
            self.jobs[index].run_at_ms = run_at_ms;
        }
        self.jobs[index].lease_until_ms = None;
        Ok(self.jobs[index].clone())
    }

    pub fn recover_expired(&mut self, actor: Principal, now_ms: u64) -> Result<u16, String> {
        if actor == Principal::anonymous() {
            return Err("Authenticated user required".into());
        }
        if actor != self.governor
            && !self
                .workers
                .iter()
                .any(|capability| capability.worker == actor)
        {
            return Err("Worker capability required".into());
        }
        let mut recovered = 0u16;
        for job in &mut self.jobs {
            if job.status == Status::Processing
                && job
                    .lease_until_ms
                    .is_some_and(|lease_until| lease_until <= now_ms)
            {
                job.lease_until_ms = None;
                if job.attempts >= 5 {
                    job.status = Status::Failed;
                    job.last_error = Some("Timer lease exhausted".into());
                } else {
                    job.status = Status::Pending;
                }
                recovered = recovered.saturating_add(1);
            }
        }
        Ok(recovered)
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.jobs.iter().find(|job| job.id == id).cloned()
    }

    pub fn jobs(&self) -> Vec<Job> {
        self.jobs.clone()
    }

    pub fn replace_jobs(&mut self, jobs: Vec<Job>) -> Result<(), String> {
        let mut ids = std::collections::BTreeSet::new();
        if jobs
            .iter()
            .any(|job| job.id.trim().is_empty() || !ids.insert(job.id.clone()))
        {
            return Err("Invalid or duplicate timer job".into());
        }
        self.jobs = jobs;
        Ok(())
    }
}

#[ic_cdk::init]
fn init() {
    save_persisted_state(PersistedState {
        queue: None,
        state: QueueState {
            armed: false,
            next_run_at_ms: None,
        },
    });
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    let persisted = persisted_state();
    CANISTER_QUEUE.with(|queue| *queue.borrow_mut() = persisted.queue);
    CANISTER_STATE.with(|state| *state.borrow_mut() = persisted.state);
}

#[ic_cdk::update]
fn initialize() -> Outcome<()> {
    authenticated()?;
    if CANISTER_QUEUE.with(|queue| queue.borrow().is_some()) {
        return Err("Already initialized".into());
    }
    save_canister_queue(TimerQueue::new(caller()));
    Ok(())
}

#[ic_cdk::update]
fn grant_worker(worker: Principal) -> Outcome<()> {
    let mut queue = canister_queue();
    queue.grant_worker(caller(), worker)?;
    save_canister_queue(queue);
    Ok(())
}

#[ic_cdk::update]
fn grant_worker_scope(worker: Principal, scope: String) -> Outcome<()> {
    let mut queue = canister_queue();
    queue.grant_worker_scope(caller(), worker, &scope)?;
    save_canister_queue(queue);
    Ok(())
}

#[ic_cdk::update]
fn grant_callback_scope(callback: Principal, scope: String) -> Outcome<()> {
    let mut queue = canister_queue();
    queue.grant_callback_scope(caller(), callback, &scope)?;
    save_canister_queue(queue);
    Ok(())
}

#[ic_cdk::update]
fn schedule(id: String, scope: String, run_at_ms: u64, idempotency_key: String) -> Outcome<Job> {
    let mut queue = canister_queue();
    let job = queue.schedule(caller(), &id, &scope, run_at_ms, &idempotency_key)?;
    save_canister_queue(queue);
    Ok(job)
}

#[ic_cdk::update]
fn schedule_with_callback(
    id: String,
    scope: String,
    callback: Option<Principal>,
    run_at_ms: u64,
    idempotency_key: String,
) -> Outcome<Job> {
    let mut queue = canister_queue();
    let job = queue.schedule_with_callback(
        caller(),
        &id,
        &scope,
        callback,
        run_at_ms,
        &idempotency_key,
    )?;
    save_canister_queue(queue);
    Ok(job)
}

#[ic_cdk::update]
fn claim(now_ms: u64, limit: u16) -> Outcome<Vec<Job>> {
    let mut queue = canister_queue();
    let jobs = queue.claim(caller(), now_ms, limit as usize)?;
    save_canister_queue(queue);
    Ok(jobs)
}

#[ic_cdk::update]
fn claim_with_lease(now_ms: u64, limit: u16, lease_ms: u64) -> Outcome<Vec<Job>> {
    let mut queue = canister_queue();
    let jobs = queue.claim_with_lease(caller(), now_ms, limit as usize, lease_ms)?;
    save_canister_queue(queue);
    Ok(jobs)
}

#[ic_cdk::update]
fn complete(id: String, idempotency_key: String) -> Outcome<Job> {
    let mut queue = canister_queue();
    let job = queue.complete(caller(), &id, &idempotency_key)?;
    save_canister_queue(queue);
    Ok(job)
}

#[ic_cdk::update]
fn fail(id: String, error: String, retry_at_ms: Option<u64>) -> Outcome<Job> {
    let mut queue = canister_queue();
    let job = queue.fail(caller(), &id, &error, retry_at_ms)?;
    save_canister_queue(queue);
    Ok(job)
}

#[ic_cdk::update]
fn recover_expired(now_ms: u64) -> Outcome<u16> {
    let mut queue = canister_queue();
    let recovered = queue.recover_expired(caller(), now_ms)?;
    save_canister_queue(queue);
    Ok(recovered)
}

#[ic_cdk::update]
fn recover_interrupted() -> Outcome<u16> {
    recover_expired(u64::MAX)
}

#[ic_cdk::update]
fn arm(next_run_at_ms: u64) -> Outcome<QueueState> {
    authenticated()?;
    let state = QueueState {
        armed: true,
        next_run_at_ms: Some(next_run_at_ms),
    };
    save_queue_state(state.clone());
    Ok(state)
}

#[ic_cdk::query]
fn get_job(id: String) -> Option<Job> {
    authenticated().ok()?;
    canister_queue().get(&id)
}

#[ic_cdk::query]
fn get_state() -> QueueState {
    queue_state()
}

#[ic_cdk::query]
fn export_state() -> Outcome<Snapshot> {
    authenticated()?;
    Ok(Snapshot {
        jobs: canister_queue().jobs(),
        state: queue_state(),
    })
}

#[ic_cdk::query]
fn reconcile(snapshot: Snapshot) -> Outcome<Reconciliation> {
    authenticated()?;
    let local = canister_queue().jobs();
    let matching = snapshot
        .jobs
        .iter()
        .filter(|job| local.iter().any(|item| item == *job))
        .count();
    Ok(Reconciliation {
        local_jobs: local.len() as u32,
        incoming_jobs: snapshot.jobs.len() as u32,
        matching_jobs: matching as u32,
    })
}

#[ic_cdk::query]
fn list_jobs(start_after: Option<String>, limit: u16) -> Outcome<Page> {
    authenticated()?;
    if limit == 0 || limit > 100 {
        return Err("Invalid page size".into());
    }
    let mut jobs = canister_queue().jobs();
    jobs.sort_by(|left, right| left.id.cmp(&right.id));
    let jobs: Vec<Job> = jobs
        .into_iter()
        .filter(|job| start_after.as_ref().is_none_or(|start| job.id > *start))
        .take(limit as usize)
        .collect();
    Ok(Page {
        next: jobs.last().map(|job| job.id.clone()),
        jobs,
    })
}

#[ic_cdk::update]
fn import_state(snapshot: Snapshot) -> Outcome<()> {
    authenticated()?;
    let mut queue = canister_queue();
    if !queue.jobs().is_empty() {
        return Err("Destination is not empty".into());
    }
    queue.replace_jobs(snapshot.jobs)?;
    save_canister_queue(queue);
    save_queue_state(snapshot.state);
    Ok(())
}

ic_cdk::export_candid!();
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_state_round_trips_callback_and_lease_metadata() {
        let governor = Principal::from_slice(&[1u8; 29]);
        let worker = Principal::from_slice(&[2u8; 29]);
        let callback = Principal::from_slice(&[3u8; 29]);

        let mut queue = TimerQueue::new(governor);
        queue.grant_worker(governor, worker).unwrap();
        queue.grant_callback_scope(governor, callback, "club-a").unwrap();
        queue
            .schedule_with_callback(
                governor,
                "upgrade-job",
                "club-a",
                Some(callback),
                100,
                "upgrade-key",
            )
            .unwrap();
        let claimed = queue
            .claim_with_lease(worker, 101, 1, 25)
            .unwrap();
        let leased = claimed.first().cloned().unwrap();
        assert_eq!(leased.lease_until_ms, Some(126));

        save_canister_queue(queue.clone());
        save_queue_state(QueueState {
            armed: true,
            next_run_at_ms: Some(150),
        });

        let restored = persisted_state();
        assert_eq!(restored.state.next_run_at_ms, Some(150));
        assert_eq!(restored.state.armed, true);
        let round_trip_job = restored.queue.as_ref().unwrap().jobs[0].clone();
        assert_eq!(round_trip_job.callback, Some(callback));
        assert_eq!(round_trip_job.lease_until_ms, Some(126));
        assert_eq!(round_trip_job.status, Status::Processing);
    }
}
impl From<Status> for JobStatus {
    fn from(value: Status) -> Self {
        match value {
            Status::Pending => JobStatus::Pending,
            Status::Processing => JobStatus::Processing,
            Status::Completed => JobStatus::Completed,
            Status::Failed => JobStatus::Failed,
        }
    }
}
