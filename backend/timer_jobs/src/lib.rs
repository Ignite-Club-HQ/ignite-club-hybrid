//! Disposable ICP proof for durable scheduled-job state.
//! The queue is synthetic and does not call external providers.
use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    storable::Bound,
    DefaultMemoryImpl, StableBTreeMap, StableCell, Storable,
};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

const ROOT_STATE_MAGIC: u8 = 0xA1;

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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Metadata {
    governor: Option<Principal>,
    workers: Vec<WorkerCapability>,
    callbacks: Vec<CallbackCapability>,
}

impl Metadata {
    fn empty() -> Self {
        Self {
            governor: None,
            workers: vec![],
            callbacks: vec![],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RootState {
    metadata: Metadata,
    state: QueueState,
}

impl RootState {
    fn empty() -> Self {
        Self {
            metadata: Metadata::empty(),
            state: QueueState {
                armed: false,
                next_run_at_ms: None,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PersistedState {
    queue: Option<TimerQueue>,
    state: QueueState,
}

impl Storable for Job {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        let mut bytes = Vec::new();
        ciborium::into_writer(self, &mut bytes).expect("job encode");
        Cow::Owned(bytes)
    }

    fn into_bytes(self) -> Vec<u8> {
        let mut bytes = Vec::new();
        ciborium::into_writer(&self, &mut bytes).expect("job encode");
        bytes
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        ciborium::from_reader(bytes.as_ref()).expect("job decode")
    }

    const BOUND: Bound = Bound::Bounded {
        max_size: 4096,
        is_fixed_size: false,
    };
}

type Outcome<T> = Result<T, String>;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static ROOT_CELL: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(0), Vec::new()));
    static JOBS: RefCell<StableBTreeMap<String, Job, Memory>> = RefCell::new(StableBTreeMap::init(memory(1)));
    static METADATA: RefCell<Metadata> = RefCell::new(Metadata::empty());
    static QUEUE_STATE: RefCell<QueueState> = RefCell::new(QueueState { armed: false, next_run_at_ms: None });
}

fn memory(id: u8) -> Memory {
    MEMORY_MANAGER.with(|manager| manager.borrow().get(MemoryId::new(id)))
}

fn encode_root(value: &RootState) -> Vec<u8> {
    let mut bytes = vec![ROOT_STATE_MAGIC];
    ciborium::into_writer(value, &mut bytes).expect("root state encode");
    bytes
}

/// Loads root state from the stable cell, migrating the legacy
/// `PersistedState { queue, state }` blob format into the new tagged
/// `RootState` + `StableBTreeMap<Job>` layout if necessary. Migration
/// happens at most once: as soon as a legacy blob is detected it is
/// decoded, the jobs are moved into the stable map, and memory 0 is
/// rewritten in the new tagged format.
fn load_root_state() -> RootState {
    let bytes = ROOT_CELL.with(|cell| cell.borrow().get().clone());
    if bytes.is_empty() {
        return RootState::empty();
    }
    if bytes[0] == ROOT_STATE_MAGIC {
        return ciborium::from_reader(&bytes[1..]).expect("root state decode");
    }
    // Legacy format: decode the whole PersistedState blob and migrate.
    let legacy: PersistedState = ciborium::from_reader(bytes.as_slice()).expect("legacy state decode");
    let metadata = match &legacy.queue {
        Some(queue) => Metadata {
            governor: Some(queue.governor),
            workers: queue.workers.clone(),
            callbacks: queue.callbacks.clone(),
        },
        None => Metadata::empty(),
    };
    if let Some(queue) = legacy.queue {
        JOBS.with(|jobs| {
            let mut jobs = jobs.borrow_mut();
            for job in queue.jobs {
                jobs.insert(job.id.clone(), job);
            }
        });
    }
    let root = RootState {
        metadata,
        state: legacy.state,
    };
    ROOT_CELL.with(|cell| cell.borrow_mut().set(encode_root(&root)));
    root
}

fn load_state_into_thread_locals() {
    let root = load_root_state();
    METADATA.with(|metadata| *metadata.borrow_mut() = root.metadata);
    QUEUE_STATE.with(|state| *state.borrow_mut() = root.state);
}

fn save_root() {
    let metadata = METADATA.with(|metadata| metadata.borrow().clone());
    let state = QUEUE_STATE.with(|state| state.borrow().clone());
    let root = RootState { metadata, state };
    ROOT_CELL.with(|cell| cell.borrow_mut().set(encode_root(&root)));
}

fn metadata() -> Metadata {
    METADATA.with(|metadata| metadata.borrow().clone())
}

fn save_metadata(value: Metadata) {
    METADATA.with(|metadata| *metadata.borrow_mut() = value);
    save_root();
}

fn queue_state() -> QueueState {
    QUEUE_STATE.with(|state| state.borrow().clone())
}

fn save_queue_state(value: QueueState) {
    QUEUE_STATE.with(|state| *state.borrow_mut() = value);
    save_root();
}

fn get_job_entry(id: &str) -> Option<Job> {
    JOBS.with(|jobs| jobs.borrow().get(&id.to_string()))
}

fn put_job_entry(job: Job) {
    JOBS.with(|jobs| {
        jobs.borrow_mut().insert(job.id.clone(), job);
    });
}

fn all_job_entries() -> Vec<Job> {
    JOBS.with(|jobs| jobs.borrow().iter().map(|entry| entry.value()).collect())
}

fn job_ids() -> Vec<String> {
    JOBS.with(|jobs| jobs.borrow().iter().map(|entry| entry.key()).collect())
}

fn jobs_is_empty() -> bool {
    JOBS.with(|jobs| jobs.borrow().is_empty())
}

fn governor() -> Principal {
    metadata()
        .governor
        .expect("timer queue is not initialized")
}

fn is_worker_or_governor(actor: Principal, meta: &Metadata) -> bool {
    actor == meta.governor.unwrap_or(Principal::anonymous())
        || meta.workers.iter().any(|capability| capability.worker == actor)
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

#[ic_cdk::init]
fn init() {
    save_root();
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    load_state_into_thread_locals();
}

#[ic_cdk::update]
fn initialize() -> Outcome<()> {
    authenticated()?;
    let mut meta = metadata();
    if meta.governor.is_some() {
        return Err("Already initialized".into());
    }
    meta.governor = Some(caller());
    meta.workers = vec![];
    meta.callbacks = vec![];
    save_metadata(meta);
    Ok(())
}

#[ic_cdk::update]
fn grant_worker(worker: Principal) -> Outcome<()> {
    grant_worker_scope(worker, "*".to_string())
}

#[ic_cdk::update]
fn grant_worker_scope(worker: Principal, scope: String) -> Outcome<()> {
    let actor = caller();
    let mut meta = metadata();
    if actor == Principal::anonymous() {
        return Err("Authenticated caller required".into());
    }
    let expected_governor = meta.governor.expect("timer queue is not initialized");
    if actor != expected_governor {
        return Err("Governor required".into());
    }
    if worker == Principal::anonymous() {
        return Err("Invalid worker".into());
    }
    if scope.trim().is_empty() {
        return Err("Invalid worker scope".into());
    }
    if !meta
        .workers
        .iter()
        .any(|capability| capability.worker == worker && capability.scope == scope)
    {
        meta.workers.push(WorkerCapability { worker, scope });
    }
    save_metadata(meta);
    Ok(())
}

#[ic_cdk::update]
fn grant_callback_scope(callback: Principal, scope: String) -> Outcome<()> {
    let actor = caller();
    let mut meta = metadata();
    if actor == Principal::anonymous() {
        return Err("Authenticated caller required".into());
    }
    let expected_governor = meta.governor.expect("timer queue is not initialized");
    if actor != expected_governor {
        return Err("Governor required".into());
    }
    if callback == Principal::anonymous() {
        return Err("Invalid callback".into());
    }
    if scope.trim().is_empty() {
        return Err("Invalid callback scope".into());
    }
    if !meta
        .callbacks
        .iter()
        .any(|capability| capability.callback == callback && capability.scope == scope)
    {
        meta.callbacks.push(CallbackCapability { callback, scope });
    }
    save_metadata(meta);
    Ok(())
}

#[ic_cdk::update]
fn schedule(id: String, scope: String, run_at_ms: u64, idempotency_key: String) -> Outcome<Job> {
    schedule_with_callback(id, scope, None, run_at_ms, idempotency_key)
}

#[ic_cdk::update]
fn schedule_with_callback(
    id: String,
    scope: String,
    callback: Option<Principal>,
    run_at_ms: u64,
    idempotency_key: String,
) -> Outcome<Job> {
    let actor = caller();
    if actor == Principal::anonymous() {
        return Err("Authenticated user required".into());
    }
    let _governor = governor();
    if let Some(existing) = get_job_entry(&id) {
        return Ok(existing);
    }
    if scope.trim().is_empty() || id.trim().is_empty() || idempotency_key.trim().is_empty() {
        return Err("Invalid timer fields".into());
    }
    let meta = metadata();
    if let Some(callback_principal) = callback {
        if !meta.callbacks.iter().any(|capability| {
            capability.callback == callback_principal
                && (capability.scope == scope || capability.scope == "*")
        }) {
            return Err("Callback capability required".into());
        }
    }
    let job = Job {
        id: id.clone(),
        scope,
        callback,
        run_at_ms,
        lease_until_ms: None,
        idempotency_key,
        status: Status::Pending,
        attempts: 0,
        last_error: None,
    };
    put_job_entry(job.clone());
    Ok(job)
}

#[ic_cdk::update]
fn claim(now_ms: u64, limit: u16) -> Outcome<Vec<Job>> {
    claim_with_lease(now_ms, limit, 60_000)
}

#[ic_cdk::update]
fn claim_with_lease(now_ms: u64, limit: u16, lease_ms: u64) -> Outcome<Vec<Job>> {
    let actor = caller();
    if actor == Principal::anonymous() {
        return Err("Authenticated user required".into());
    }
    if limit == 0 || lease_ms == 0 {
        return Err("Invalid claim bounds".into());
    }
    let meta = metadata();
    let _governor = meta.governor.expect("timer queue is not initialized");
    if !is_worker_or_governor(actor, &meta) {
        return Err("Worker capability required".into());
    }
    let limit = limit as usize;
    let mut claimed = Vec::new();
    for id in job_ids() {
        if claimed.len() >= limit {
            break;
        }
        let mut job = match get_job_entry(&id) {
            Some(job) => job,
            None => continue,
        };
        let scope_allowed = actor == meta.governor.unwrap()
            || meta.workers.iter().any(|capability| {
                capability.worker == actor
                    && (capability.scope == "*" || capability.scope == job.scope)
            });
        let callback_allowed = job.callback.is_none()
            || meta.callbacks.iter().any(|capability| {
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
            put_job_entry(job.clone());
            claimed.push(job);
        }
    }
    Ok(claimed)
}

#[ic_cdk::update]
fn complete(id: String, idempotency_key: String) -> Outcome<Job> {
    let actor = caller();
    if actor == Principal::anonymous() {
        return Err("Authenticated caller required".into());
    }
    let meta = metadata();
    let _governor = meta.governor.expect("timer queue is not initialized");
    if !is_worker_or_governor(actor, &meta) {
        return Err("Worker capability required".into());
    }
    let mut job = get_job_entry(&id).ok_or("Unknown job")?;
    if job.idempotency_key != idempotency_key {
        return Err("Idempotency key mismatch".into());
    }
    if job.status == Status::Completed {
        return Ok(job);
    }
    if job.status != Status::Processing {
        return Err("Job is not processing".into());
    }
    job.status = Status::Completed;
    job.lease_until_ms = None;
    put_job_entry(job.clone());
    Ok(job)
}

#[ic_cdk::update]
fn fail(id: String, error: String, retry_at_ms: Option<u64>) -> Outcome<Job> {
    let actor = caller();
    if actor == Principal::anonymous() {
        return Err("Authenticated caller required".into());
    }
    let meta = metadata();
    let _governor = meta.governor.expect("timer queue is not initialized");
    if !is_worker_or_governor(actor, &meta) {
        return Err("Worker capability required".into());
    }
    let mut job = get_job_entry(&id).ok_or("Unknown job")?;
    if job.status != Status::Processing {
        return Err("Job is not processing".into());
    }
    job.last_error = Some(error);
    job.status = if retry_at_ms.is_some() && job.attempts < 5 {
        Status::Pending
    } else {
        Status::Failed
    };
    if let Some(run_at_ms) = retry_at_ms {
        job.run_at_ms = run_at_ms;
    }
    job.lease_until_ms = None;
    put_job_entry(job.clone());
    Ok(job)
}

#[ic_cdk::update]
fn recover_expired(now_ms: u64) -> Outcome<u16> {
    let actor = caller();
    if actor == Principal::anonymous() {
        return Err("Authenticated user required".into());
    }
    let meta = metadata();
    let _governor = meta.governor.expect("timer queue is not initialized");
    if !is_worker_or_governor(actor, &meta) {
        return Err("Worker capability required".into());
    }
    let mut recovered = 0u16;
    for id in job_ids() {
        let mut job = match get_job_entry(&id) {
            Some(job) => job,
            None => continue,
        };
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
            put_job_entry(job);
            recovered = recovered.saturating_add(1);
        }
    }
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
    let _governor = governor();
    get_job_entry(&id)
}

#[ic_cdk::query]
fn get_state() -> QueueState {
    queue_state()
}

#[ic_cdk::query]
fn export_state() -> Outcome<Snapshot> {
    authenticated()?;
    let _governor = governor();
    Ok(Snapshot {
        jobs: all_job_entries(),
        state: queue_state(),
    })
}

#[ic_cdk::query]
fn reconcile(snapshot: Snapshot) -> Outcome<Reconciliation> {
    authenticated()?;
    let _governor = governor();
    let local = all_job_entries();
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
    let _governor = governor();
    if limit == 0 || limit > 100 {
        return Err("Invalid page size".into());
    }
    let mut jobs = all_job_entries();
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
    let _governor = governor();
    if !jobs_is_empty() {
        return Err("Destination is not empty".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    if snapshot
        .jobs
        .iter()
        .any(|job| job.id.trim().is_empty() || !ids.insert(job.id.clone()))
    {
        return Err("Invalid or duplicate timer job".into());
    }
    for job in snapshot.jobs {
        put_job_entry(job);
    }
    save_queue_state(snapshot.state);
    Ok(())
}

ic_cdk::export_candid!();

#[cfg(test)]
mod tests {
    use super::*;
    use ic_stable_structures::memory_manager::MemoryManager as MM;
    use ic_stable_structures::VectorMemory;
    use std::sync::Mutex;

    // Serialize tests that touch the shared thread-local stable memory.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Resets all thread-locals to a brand-new in-memory backing store so
    /// each test starts from a clean slate, independent of test order.
    fn reset_with_fresh_memory() {
        let backing: VectorMemory = VectorMemory::default();
        MEMORY_MANAGER.with(|manager| {
            *manager.borrow_mut() = MM::init(backing);
        });
        ROOT_CELL.with(|cell| {
            *cell.borrow_mut() = StableCell::init(memory(0), Vec::new());
        });
        JOBS.with(|jobs| {
            *jobs.borrow_mut() = StableBTreeMap::init(memory(1));
        });
        METADATA.with(|metadata| *metadata.borrow_mut() = Metadata::empty());
        QUEUE_STATE.with(|state| {
            *state.borrow_mut() = QueueState {
                armed: false,
                next_run_at_ms: None,
            }
        });
    }

    /// Simulates a canister upgrade: drops the in-process thread-local
    /// caches (as if the wasm instance were torn down) while keeping the
    /// same underlying `VectorMemory` bytes, then reloads state from it
    /// exactly like `post_upgrade` would.
    fn simulate_upgrade() {
        METADATA.with(|metadata| *metadata.borrow_mut() = Metadata::empty());
        QUEUE_STATE.with(|state| {
            *state.borrow_mut() = QueueState {
                armed: false,
                next_run_at_ms: None,
            }
        });
        load_state_into_thread_locals();
    }

    #[test]
    fn normal_operation_schedules_claims_and_completes_via_stable_map() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_with_fresh_memory();

        let governor = Principal::from_slice(&[1u8; 29]);
        let worker = Principal::from_slice(&[2u8; 29]);
        save_metadata(Metadata {
            governor: Some(governor),
            workers: vec![WorkerCapability {
                worker,
                scope: "*".into(),
            }],
            callbacks: vec![],
        });

        let job = Job {
            id: "job-1".into(),
            scope: "club-a".into(),
            callback: None,
            run_at_ms: 0,
            lease_until_ms: None,
            idempotency_key: "key-1".into(),
            status: Status::Pending,
            attempts: 0,
            last_error: None,
        };
        put_job_entry(job);
        assert_eq!(all_job_entries().len(), 1);

        // Directly exercise the map-backed helpers the endpoints use.
        let mut fetched = get_job_entry("job-1").unwrap();
        fetched.status = Status::Processing;
        fetched.attempts += 1;
        fetched.lease_until_ms = Some(60_000);
        put_job_entry(fetched.clone());

        let mut completed = get_job_entry("job-1").unwrap();
        assert_eq!(completed.status, Status::Processing);
        completed.status = Status::Completed;
        completed.lease_until_ms = None;
        put_job_entry(completed.clone());

        let stored = get_job_entry("job-1").unwrap();
        assert_eq!(stored.status, Status::Completed);
        assert_eq!(all_job_entries().len(), 1);
    }

    #[test]
    fn upgrade_round_trip_preserves_metadata_and_jobs() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_with_fresh_memory();

        let governor = Principal::from_slice(&[3u8; 29]);
        let callback = Principal::from_slice(&[4u8; 29]);
        save_metadata(Metadata {
            governor: Some(governor),
            workers: vec![],
            callbacks: vec![CallbackCapability {
                callback,
                scope: "club-b".into(),
            }],
        });
        save_queue_state(QueueState {
            armed: true,
            next_run_at_ms: Some(500),
        });
        put_job_entry(Job {
            id: "upgrade-job".into(),
            scope: "club-b".into(),
            callback: Some(callback),
            run_at_ms: 42,
            lease_until_ms: None,
            idempotency_key: "upgrade-key".into(),
            status: Status::Pending,
            attempts: 0,
            last_error: None,
        });

        // Simulate a canister upgrade: thread-locals reset, only the
        // backing VectorMemory bytes survive, then state reloads from it.
        simulate_upgrade();

        let meta = metadata();
        assert_eq!(meta.governor, Some(governor));
        assert_eq!(meta.callbacks.len(), 1);
        let state = queue_state();
        assert_eq!(state.armed, true);
        assert_eq!(state.next_run_at_ms, Some(500));
        let job = get_job_entry("upgrade-job").expect("job survives upgrade");
        assert_eq!(job.callback, Some(callback));
        assert_eq!(job.run_at_ms, 42);
    }

    #[test]
    fn legacy_blob_is_migrated_into_stable_map_exactly_once() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_with_fresh_memory();

        let governor = Principal::from_slice(&[5u8; 29]);
        let worker = Principal::from_slice(&[6u8; 29]);
        let mut legacy_queue = TimerQueue::new(governor);
        legacy_queue.grant_worker(governor, worker).unwrap();
        legacy_queue
            .schedule(governor, "legacy-job", "club-c", 10, "legacy-key")
            .unwrap();
        let legacy = PersistedState {
            queue: Some(legacy_queue),
            state: QueueState {
                armed: true,
                next_run_at_ms: Some(999),
            },
        };
        let mut legacy_bytes = Vec::new();
        ciborium::into_writer(&legacy, &mut legacy_bytes).unwrap();
        // Sanity: legacy blobs never start with the new-format magic byte.
        assert_ne!(legacy_bytes.first().copied(), Some(ROOT_STATE_MAGIC));
        ROOT_CELL.with(|cell| cell.borrow_mut().set(legacy_bytes));

        // First load triggers migration and rewrites memory 0 in the
        // tagged format.
        load_state_into_thread_locals();

        let meta = metadata();
        assert_eq!(meta.governor, Some(governor));
        assert_eq!(meta.workers.len(), 1);
        let state = queue_state();
        assert_eq!(state.next_run_at_ms, Some(999));
        let job = get_job_entry("legacy-job").expect("legacy job migrated");
        assert_eq!(job.idempotency_key, "legacy-key");

        let tagged_bytes = ROOT_CELL.with(|cell| cell.borrow().get().clone());
        assert_eq!(tagged_bytes.first().copied(), Some(ROOT_STATE_MAGIC));

        // Loading again is idempotent: metadata/jobs are unchanged, and
        // the migration branch is not re-entered (bytes are already
        // tagged).
        load_state_into_thread_locals();
        assert_eq!(metadata().governor, Some(governor));
        assert_eq!(get_job_entry("legacy-job").unwrap().idempotency_key, "legacy-key");
    }

    #[test]
    fn stable_state_round_trips_callback_and_lease_metadata() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset_with_fresh_memory();

        let governor = Principal::from_slice(&[7u8; 29]);
        let worker = Principal::from_slice(&[8u8; 29]);
        let callback = Principal::from_slice(&[9u8; 29]);

        save_metadata(Metadata {
            governor: Some(governor),
            workers: vec![WorkerCapability {
                worker,
                scope: "*".into(),
            }],
            callbacks: vec![CallbackCapability {
                callback,
                scope: "club-a".into(),
            }],
        });

        let mut job = Job {
            id: "upgrade-job".into(),
            scope: "club-a".into(),
            callback: Some(callback),
            run_at_ms: 100,
            lease_until_ms: None,
            idempotency_key: "upgrade-key".into(),
            status: Status::Processing,
            attempts: 1,
            last_error: None,
        };
        job.lease_until_ms = Some(126);
        put_job_entry(job);

        save_queue_state(QueueState {
            armed: true,
            next_run_at_ms: Some(150),
        });

        let state = queue_state();
        assert_eq!(state.next_run_at_ms, Some(150));
        assert_eq!(state.armed, true);
        let round_trip_job = get_job_entry("upgrade-job").unwrap();
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
