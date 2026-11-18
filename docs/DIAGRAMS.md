# Niramoy project diagrams

These diagrams are derived from the current Next.js routes, services, repositories, and Drizzle schema. They describe the implemented system as of 2026-11-09.

## 1. System context

```mermaid
flowchart LR
    Patient([Patient])
    Doctor([Doctor])
    Admin([Admin])
    Niramoy[[Niramoy telemedicine platform]]
    SMS[(SMS provider)]
    BMDC[(BM&DC verification service)]
    Pay[(bKash / SSLCommerz or mock payment provider)]
    Video[(Jitsi / Daily / placeholder video provider)]
    LLM[(Optional LLM provider)]
    DB[(PostgreSQL / Neon / PGlite)]

    Patient --> Niramoy
    Doctor --> Niramoy
    Admin --> Niramoy
    Niramoy --> SMS
    Niramoy --> BMDC
    Niramoy --> Pay
    Niramoy --> Video
    Niramoy --> LLM
    Niramoy --> DB
```

## 2. Use-case diagrams

### 2.1 Complete platform use cases

```mermaid
flowchart LR
    Patient([Patient])
    Doctor([Doctor])
    Admin([Admin])
    Guest([Guest])
    Payment((Payment provider))
    Registry((BM&DC registry))

    subgraph Niramoy[ Niramoy platform ]
        UC1((Register / sign in))
        UC2((Verify phone and email))
        UC3((Find doctors))
        UC4((Run AI symptom triage))
        UC5((Receive doctor recommendations))
        UC6((Book appointment))
        UC7((Pay consultation fee))
        UC8((Join video consultation))
        UC9((View records and prescriptions))
        UC10((Write review))
        UC11((Manage family members))
        UC12((Manage availability))
        UC13((Write prescription))
        UC14((Create / approve AI visit summary))
        UC15((Apply as doctor))
        UC16((Verify doctor))
        UC17((Manage directory))
        UC18((Review audit and diagnostics))
        UC19((Join waitlist / claim offered slot))
    end

    Guest --> UC1
    Guest --> UC3
    Patient --> UC1
    Patient --> UC2
    Patient --> UC3
    Patient --> UC4
    Patient --> UC5
    Patient --> UC6
    Patient --> UC7
    Patient --> UC8
    Patient --> UC9
    Patient --> UC10
    Patient --> UC11
    Patient --> UC19
    Doctor --> UC1
    Doctor --> UC2
    Doctor --> UC12
    Doctor --> UC8
    Doctor --> UC13
    Doctor --> UC14
    Doctor --> UC15
    Admin --> UC1
    Admin --> UC16
    Admin --> UC17
    Admin --> UC18
    Payment --> UC7
    Registry --> UC16
    UC4 -. suggests .-> UC5
    UC6 -. may require .-> UC7
    UC8 -. produces clinical data for .-> UC13
    UC14 -. publishes approved content to .-> UC9
```

### 2.2 Doctor onboarding and verification use cases

```mermaid
flowchart LR
    Admin([Admin])
    Doctor([Doctor applicant])
    Registry((BM&DC register))

    subgraph Onboarding[Doctor onboarding]
        A((Admin checks registration number))
        B((Admin creates sign-up approval))
        C((Doctor verifies phone))
        D((Doctor registers with approved number))
        E((Doctor submits profile))
        F((System verifies automatically when possible))
        G((Admin reviews pending verification))
        H((Publish verified profile))
    end

    Admin --> A --> B
    Registry --> A
    Doctor --> C --> D --> E
    B -. registration number + phone .-> D
    E --> F
    F -->|verified| H
    F -->|pending / unavailable| G --> H
    Admin --> G
```

## 3. Sequence diagrams

### 3.1 Registration, phone verification, and session creation

```mermaid
sequenceDiagram
    actor U as User
    participant UI as Web client
    participant R as Auth route
    participant S as Auth service
    participant O as Doctor approval repository
    participant P as Phone verification service
    participant SMS as SMS provider
    participant DB as PostgreSQL

    U->>UI: Enter phone number
    UI->>R: POST /api/auth/signup-otp
    R->>P: Create verification challenge
    P->>DB: Insert phone_verifications
    P->>SMS: Send six-digit code
    SMS-->>P: Delivery result
    P-->>UI: Challenge response
    U->>UI: Enter code and registration details
    UI->>R: POST /api/auth/register
    R->>S: register(input)
    S->>P: claimSignupVerification(phone, ticket)
    P->>DB: Consume valid phone ticket
    alt Doctor registration
        S->>O: Check approved BM&DC number + phone pair
        O->>DB: Read / claim doctor_approvals
    end
    S->>DB: Transaction: create users and role profile
    S->>DB: Create sessions row
    S-->>R: User + session cookie
    R-->>UI: Registration success
```

### 3.2 Appointment booking and payment

```mermaid
sequenceDiagram
    actor P as Patient
    participant UI as Web client
    participant AR as Appointment route
    participant BS as Booking service
    participant SE as Scheduling engine
    participant DB as PostgreSQL
    participant NS as Notification service
    participant PR as Payment route
    participant PS as Payment service
    participant GW as Payment gateway

    P->>UI: Select doctor and slot
    UI->>AR: POST /api/appointments
    AR->>BS: book(patient, doctor, requestedStart)
    BS->>SE: Generate available slots
    SE-->>BS: Candidate slot list
    BS->>DB: Read existing doctor/patient intervals
    BS->>SE: Advisory canBook check
    alt Slot invalid or already unavailable
        SE-->>AR: Typed booking error
        AR-->>UI: 409 / validation response
    else Candidate slot passes pre-check
        BS->>DB: BEGIN + per-doctor advisory lock
        BS->>DB: INSERT appointments
        DB-->>BS: Constraint result
        alt Exclusion constraint rejects overlap
            BS-->>AR: APPOINTMENT_CONFLICT
            AR-->>UI: 409 conflict
        else Insert succeeds
            BS->>DB: Insert status history
            BS->>NS: Create appointment notification
            BS->>DB: Append audit log
            BS-->>AR: Confirmed appointment
            AR-->>UI: Appointment details
        end
    end
    P->>UI: Choose bKash / cash
    UI->>PR: POST /api/payments
    PR->>PS: startPayment(appointment)
    PS->>DB: Read appointment fee (server authoritative)
    alt bKash / hosted gateway
        PS->>GW: Create payment intent
        GW-->>PS: Pending intent / redirect URL
    end
    PS->>DB: Insert pending payment
    PS-->>UI: Checkout state
    GW->>PR: POST /api/payments/webhook
    PR->>PS: Verify webhook signature and event
    PS->>DB: Mark payment succeeded only after verification
```

### 3.3 Consultation, video access, and clinical output

```mermaid
sequenceDiagram
    actor P as Patient
    actor D as Doctor
    participant UI as Web client
    participant VR as Video route
    participant VS as Video service
    participant DB as PostgreSQL
    participant VP as Video provider
    participant SR as Summary route
    participant AIS as AI service
    participant CR as Clinical repository

    P->>UI: Request to join appointment
    UI->>VR: POST /api/appointments/:id/video
    VR->>VS: getJoinGrant(principal, appointmentId)
    VS->>DB: Load appointment and existing video session
    VS->>VS: Check participant identity, status, and time window
    alt Not the patient/doctor or outside window
        VS-->>VR: NOT_FOUND / NOT_ELIGIBLE
        VR-->>UI: Denied
    else Eligible participant
        VS->>VP: Create or reuse room
        VP-->>VS: Room handle
        VS->>DB: Upsert video_sessions and join timestamp
        VS->>VP: Mint short-lived join token
        VS-->>VR: Join grant
        VR-->>UI: Room + token
    end
    D->>UI: Submit notes / request AI summary
    UI->>SR: POST /api/ai/summary
    SR->>AIS: Draft visit summary
    AIS->>DB: Insert ai_visit_summaries (pending review)
    AIS-->>UI: Draft summary
    D->>UI: Approve or edit draft
    UI->>SR: PATCH /api/ai/summary/:id
    SR->>AIS: Review summary
    AIS->>DB: Set review status and reviewer
    AIS->>CR: Insert approved medical_records row
    AIS->>DB: Link publishedRecordId
    AIS-->>UI: Published clinical record
```

### 3.4 AI symptom triage and safety controls

```mermaid
sequenceDiagram
    actor P as Patient
    participant UI as Web client
    participant R as Triage route
    participant A as AI service
    participant Rules as Deterministic rules
    participant LLM as Optional LLM
    participant DB as PostgreSQL
    participant Audit as Safety/audit logs

    P->>UI: Submit symptom description
    UI->>R: POST /api/ai/triage
    R->>A: runTriage(message, intake)
    A->>Rules: Evaluate red flags and baseline urgency
    alt Red flag detected
        Rules-->>A: Emergency + rule id
        A->>DB: Store minimised triage provenance
        A->>Audit: Record emergency safety event
        Note over A,LLM: Patient text is never sent to the model
    else No red flag
        Rules-->>A: Rule urgency + specialty hint
        alt LLM configured
            A->>LLM: Send non-emergency input
            LLM-->>A: Structured candidate result
            A->>A: Validate schema and enforce urgency floor
            alt Invalid or downgrade attempt
                A->>Audit: Record rejection / downgrade block
                A->>A: Keep deterministic result
            end
        end
        A->>DB: Store minimised triage provenance
        A->>Audit: Record triage outcome
    end
    A-->>R: Urgency + specialty + safety metadata
    R-->>UI: Triage result and next action
```

### 3.5 Doctor verification decision flow

```mermaid
sequenceDiagram
    actor D as Doctor
    actor A as Admin
    participant UI as Web client
    participant R as Verification route
    participant S as Verification service
    participant BMDC as BM&DC adapter
    participant DB as PostgreSQL

    D->>UI: Submit BM&DC number and profile
    UI->>R: POST /api/verification
    R->>S: submitVerification(input)
    S->>BMDC: verifyRegistration(number)
    alt Registry configured and confirms number
        BMDC-->>S: Verified
        S->>DB: Insert doctor_verifications(status=verified)
        S->>DB: Publish doctors profile
    else Registry unavailable or not confirmed
        BMDC-->>S: Pending / unavailable
        S->>DB: Insert doctor_verifications(status=pending)
        A->>UI: Open admin verification queue
        UI->>R: Admin decision
        R->>S: Approve or reject verification
        S->>DB: Update decision and publish/reject profile
    end
    S-->>UI: Verification status
```

### 3.6 Waitlist offer and claim

```mermaid
sequenceDiagram
    actor P1 as Patient 1
    actor P2 as Patient 2
    participant R as Waitlist/appointment routes
    participant W as Waitlist service
    participant DB as PostgreSQL
    participant N as Notification service

    P1->>R: Join waitlist for doctor/date
    R->>W: join(patient, doctor, date)
    W->>DB: Insert waitlist_entries(status=waiting)
    P2->>R: Cancel appointment
    R->>W: offerToWaitlist(doctor, freedInterval)
    W->>DB: Conditional UPDATE with FOR UPDATE SKIP LOCKED
    alt Eligible waiting entry exists
        DB-->>W: One entry moved to offered
        W->>N: Notify claimant with 15-minute hold
        N-->>P1: Slot offer
        P1->>R: Claim offer
        R->>W: Normal booking attempt
        W->>DB: Insert appointment under exclusion constraint
    else No eligible entry
        DB-->>W: No offer made
    end
    Note over W,DB: Expired offers return to waiting and are offered onward
```

## 4. Class diagram

This is the domain class model. The persistent classes correspond to the Drizzle tables; service and provider classes show the main application abstractions around them.

```mermaid
classDiagram
    class User {
        +UUID id
        +UserRole role
        +String email
        +String phone
        +UserStatus status
    }
    class Patient {
        +UUID id
        +UUID userId
        +String patientCode
    }
    class Doctor {
        +UUID id
        +UUID userId
        +String displayName
        +String specialtyId
        +VerificationStatus verificationStatus
        +Decimal feeAmount
    }
    class Admin {
        +UUID userId
    }
    class Session {
        +UUID id
        +UUID userId
        +String tokenHash
        +Date expiresAt
    }
    class DoctorVerification {
        +UUID id
        +String registrationNumber
        +VerificationStatus status
        +VerificationMethod method
    }
    class Specialty {
        +String id
        +String name
    }
    class Facility {
        +String id
        +String name
        +String kind
    }
    class DoctorAvailability {
        +UUID id
        +UUID doctorId
        +String timezone
        +Time startLocal
        +Time endLocal
    }
    class Appointment {
        +UUID id
        +String reference
        +UUID doctorId
        +UUID patientId
        +Date startUtc
        +Date endUtc
        +AppointmentStatus status
    }
    class VideoSession {
        +UUID appointmentId
        +String provider
        +String roomName
        +Date expiresAt
    }
    class Payment {
        +UUID id
        +UUID appointmentId
        +PaymentMethod method
        +PaymentStatus status
        +Decimal amount
    }
    class MedicalRecord {
        +UUID id
        +UUID patientId
        +RecordKind kind
        +Boolean isCurrent
        +UUID supersedesId
    }
    class Prescription {
        +UUID id
        +String prescriptionNumber
        +UUID patientId
        +UUID doctorId
        +PrescriptionStatus status
    }
    class PrescriptionItem {
        +UUID id
        +UUID prescriptionId
        +String medicine
        +String dosage
    }
    class Review {
        +UUID id
        +UUID appointmentId
        +Integer rating
        +ReviewStatus status
    }
    class AiTriageSession {
        +UUID id
        +UrgencyLevel urgency
        +UrgencyLevel ruleUrgency
        +Boolean redFlagTriggered
        +Boolean llmInvoked
    }
    class AiVisitSummary {
        +UUID id
        +UUID appointmentId
        +AiReviewStatus reviewStatus
        +Boolean requiresReview
        +UUID publishedRecordId
    }
    class SafetyEvent {
        +UUID id
        +SafetyEventType type
        +Integer severity
        +JSON detail
    }
    class Notification {
        +UUID id
        +UUID userId
        +NotificationStatus status
        +NotificationChannel channel
    }
    class WaitlistEntry {
        +UUID id
        +UUID doctorId
        +UUID patientId
        +WaitlistStatus status
        +Date offerExpiresAt
    }
    class AuthService
    class BookingService
    class AiService
    class VerificationService
    class PaymentService
    class VideoService

    User "1" --> "0..1" Patient : owns
    User "1" --> "0..1" Doctor : owns
    User "1" --> "0..*" Session : authenticates
    User "1" --> "0..*" Notification : receives
    User "1" --> "0..*" DoctorVerification : submits/decides
    Doctor "1" --> "1..*" Specialty : has
    Doctor "0..*" --> "0..1" Facility : practices at
    Doctor "1" --> "0..*" DoctorAvailability : publishes
    Doctor "1" --> "0..*" Appointment : attends
    Patient "1" --> "0..*" Appointment : books
    Appointment "1" --> "0..1" VideoSession : has
    Appointment "1" --> "0..*" Payment : paid by attempts
    Appointment "1" --> "0..*" MedicalRecord : produces
    Appointment "1" --> "0..*" Prescription : results in
    Prescription "1" --> "1..*" PrescriptionItem : contains
    Appointment "1" --> "0..1" Review : receives
    Patient "1" --> "0..*" MedicalRecord : owns
    Patient "1" --> "0..*" Prescription : receives
    Doctor "1" --> "0..*" Prescription : issues
    User "1" --> "0..*" AiTriageSession : initiates
    Appointment "1" --> "0..*" AiVisitSummary : has
    AiVisitSummary "0..1" --> "0..1" MedicalRecord : publishes as
    AiTriageSession "1" --> "0..*" SafetyEvent : emits
    AiVisitSummary "1" --> "0..*" SafetyEvent : emits
    Doctor "1" --> "0..*" WaitlistEntry : target
    Patient "1" --> "0..*" WaitlistEntry : joins
    AuthService ..> User : manages
    BookingService ..> Appointment : creates safely
    AiService ..> AiTriageSession : evaluates
    AiService ..> AiVisitSummary : drafts
    VerificationService ..> DoctorVerification : decides
    PaymentService ..> Payment : orchestrates
    VideoService ..> VideoSession : grants access
```

## 5. Entity–relationship diagram

```mermaid
erDiagram
    USERS ||--o| PATIENTS : has
    USERS ||--o| DOCTORS : has
    USERS ||--o{ SESSIONS : opens
    USERS ||--o{ AUTH_TOKENS : receives
    USERS ||--o{ PHONE_VERIFICATIONS : verifies
    USERS ||--o| FAMILY_ACCOUNTS : owns
    FAMILY_ACCOUNTS ||--o{ FAMILY_MEMBERS : contains
    PATIENTS ||--o{ FAMILY_MEMBERS : represents

    DIVISIONS ||--o{ DISTRICTS : contains
    DIVISIONS ||--o{ FACILITIES : locates
    DISTRICTS ||--o{ FACILITIES : locates
    SPECIALTIES ||--o{ DOCTORS : primary_specialty
    SPECIALTIES ||--o{ DOCTOR_SPECIALTIES : classifies
    DOCTORS ||--o{ DOCTOR_SPECIALTIES : has
    DOCTORS ||--o{ DOCTOR_LOCATIONS : works_at
    FACILITIES ||--o{ DOCTOR_LOCATIONS : hosts
    DOCTOR_VERIFICATIONS ||--o{ DOCTOR_DOCUMENTS : includes
    DOCTORS ||--o{ DOCTOR_VERIFICATIONS : has
    USERS ||--o{ DOCTOR_VERIFICATIONS : submits_or_decides
    USERS ||--o{ DOCTOR_APPROVALS : manages

    DOCTORS ||--o{ DOCTOR_AVAILABILITY : publishes
    DOCTORS ||--o{ AVAILABILITY_EXCEPTIONS : overrides
    DOCTORS ||--o{ APPOINTMENTS : attends
    PATIENTS ||--o{ APPOINTMENTS : books
    USERS ||--o{ APPOINTMENTS : books_or_cancels
    FAMILY_MEMBERS ||--o{ APPOINTMENTS : for
    APPOINTMENTS ||--o{ APPOINTMENT_STATUS_HISTORY : changes
    APPOINTMENTS ||--o| VIDEO_SESSIONS : opens
    DOCTORS ||--o{ WAITLIST_ENTRIES : targeted
    PATIENTS ||--o{ WAITLIST_ENTRIES : joins
    APPOINTMENTS ||--o| WAITLIST_ENTRIES : claimed_by

    PATIENTS ||--o{ MEDICAL_RECORDS : owns
    APPOINTMENTS ||--o{ MEDICAL_RECORDS : produces
    USERS ||--o{ MEDICAL_RECORDS : authors
    MEDICAL_RECORDS ||--o{ MEDICAL_RECORDS : amendment_chain
    APPOINTMENTS ||--o{ PRESCRIPTIONS : results_in
    PATIENTS ||--o{ PRESCRIPTIONS : receives
    DOCTORS ||--o{ PRESCRIPTIONS : issues
    PRESCRIPTIONS ||--o{ PRESCRIPTION_ITEMS : contains
    APPOINTMENTS ||--o| REVIEWS : receives
    PATIENTS ||--o{ REVIEWS : writes
    DOCTORS ||--o{ REVIEWS : receives

    USERS ||--o{ AI_TRIAGE_SESSIONS : initiates
    PATIENTS ||--o{ AI_TRIAGE_SESSIONS : relates_to
    SPECIALTIES ||--o{ AI_TRIAGE_SESSIONS : suggests
    APPOINTMENTS ||--o{ AI_VISIT_SUMMARIES : has
    DOCTORS ||--o{ AI_VISIT_SUMMARIES : reviews
    PATIENTS ||--o{ AI_VISIT_SUMMARIES : concerns
    MEDICAL_RECORDS ||--o{ AI_VISIT_SUMMARIES : published_record
    AI_TRIAGE_SESSIONS ||--o{ SAFETY_EVENTS : emits
    AI_VISIT_SUMMARIES ||--o{ SAFETY_EVENTS : emits
    APPOINTMENTS ||--o{ SAFETY_EVENTS : concerns

    USERS ||--o{ NOTIFICATIONS : receives
    APPOINTMENTS ||--o{ PAYMENTS : billed
    PATIENTS ||--o{ PAYMENTS : pays
    USERS ||--o{ PAYMENTS : payer
    PAYMENTS ||--o{ PAYMENT_WEBHOOK_EVENTS : receives
    USERS ||--o{ AUDIT_LOGS : acts
    USERS ||--o{ RATE_LIMIT_COUNTERS : limited
    USERS ||--o{ JOB_RUNS : owns
```

## 6. Relational mapping diagrams

### 6.1 Conceptual model to relational schema

```mermaid
flowchart LR
    subgraph Identity[Identity]
        C1[Account]
        C2[Patient identity]
        C3[Doctor identity]
        C4[Family/dependent]
    end
    subgraph Directory[Directory]
        C5[Geography]
        C6[Specialty]
        C7[Facility]
        C8[Doctor verification]
    end
    subgraph Scheduling[Scheduling]
        C9[Availability]
        C10[Appointment]
        C11[Waitlist]
        C12[Video room]
    end
    subgraph Clinical[Clinical]
        C13[Medical record]
        C14[Prescription]
        C15[Review]
    end
    subgraph Intelligence[AI and safety]
        C16[Triage session]
        C17[Visit summary]
        C18[Safety event]
    end
    subgraph Platform[Platform services]
        C19[Payment]
        C20[Notification]
        C21[Audit / rate limit / jobs]
    end

    R1[(users)]
    R2[(patients)]
    R3[(doctors)]
    R4[(family_accounts + family_members)]
    R5[(divisions + districts)]
    R6[(specialties)]
    R7[(facilities)]
    R8[(doctor_verifications + documents + approvals)]
    R9[(doctor_availability + exceptions)]
    R10[(appointments + status_history)]
    R11[(waitlist_entries)]
    R12[(video_sessions)]
    R13[(medical_records)]
    R14[(prescriptions + items)]
    R15[(reviews)]
    R16[(ai_triage_sessions)]
    R17[(ai_visit_summaries)]
    R18[(safety_events)]
    R19[(payments + webhook_events)]
    R20[(notifications)]
    R21[(audit_logs + rate_limit_counters + job_runs)]

    C1 --> R1
    C2 --> R2
    C3 --> R3
    C4 --> R4
    C5 --> R5
    C6 --> R6
    C7 --> R7
    C8 --> R8
    C9 --> R9
    C10 --> R10
    C11 --> R11
    C12 --> R12
    C13 --> R13
    C14 --> R14
    C15 --> R15
    C16 --> R16
    C17 --> R17
    C18 --> R18
    C19 --> R19
    C20 --> R20
    C21 --> R21
```

### 6.2 Relation inventory and key mapping

| Relational area | Relations | Primary key(s) | Main foreign-key links | Important integrity rule |
|---|---|---|---|---|
| Identity | `users`, `patients`, `sessions`, `auth_tokens`, `phone_verifications` | UUID per row | user → patient/session/token/verification | session tokens are stored hashed; phone tickets are consumed |
| Family access | `family_accounts`, `family_members` | UUID per row | account → member → patient/user | booking for a dependent is scoped to the owner’s household |
| Directory | `divisions`, `districts`, `specialties`, `facilities` | stable text IDs | district → division; facility → geography | reference vocabulary is stable and reusable |
| Doctors | `doctors`, `doctor_specialties`, `doctor_locations` | doctor UUID; composite join rows | doctor → user/specialty/facility/geography | only verified, non-suspended profiles are bookable |
| Verification | `doctor_verifications`, `doctor_documents`, `doctor_approvals` | UUID per row | verification → doctor/user/specialty/geography | verified status requires evidence; approval can be claimed once |
| Availability | `doctor_availability`, `availability_exceptions` | UUID per row | both → doctor | local time window + IANA zone converted to UTC |
| Scheduling | `appointments`, `appointment_status_history` | appointment UUID; history UUID | appointment → doctor/patient/user/family member | PostgreSQL exclusion constraint prevents live overlaps |
| Waitlist/video | `waitlist_entries`, `video_sessions` | UUID; appointment UUID for video | waitlist → doctor/patient/appointment | one expiring offer at a time; room access is participant-scoped |
| Clinical | `medical_records`, `prescriptions`, `prescription_items`, `reviews` | UUID; prescription number unique | clinical rows → appointment/patient/doctor/user | records and corrections are append-oriented; one review per appointment |
| AI safety | `ai_triage_sessions`, `ai_visit_summaries`, `safety_events` | UUID per row | AI rows → appointment/patient/doctor/user/record | urgency floor, human review, and no-red-flag downgrade constraints |
| Platform | `notifications`, `payments`, `payment_webhook_events` | UUID per row | notification/payment → user/appointment/patient | non-mock payment becomes succeeded only from verified webhook |
| Governance | `audit_logs`, `rate_limit_counters`, `job_runs` | UUID or composite logical key | audit/job → user | audit and safety streams are append-only; counters are durable/shared |

### 6.3 Core relational constraints

```mermaid
flowchart TD
    A[Candidate appointment] --> B{Live doctor overlap?}
    B -->|yes| C[Reject with SQLSTATE 23P01]
    B -->|no| D{Live patient overlap?}
    D -->|yes| E[Reject as patient double-booking]
    D -->|no| F[Insert appointment]

    G[AI summary draft] --> H{Human approved?}
    H -->|no| I[Remain pending / rejected]
    H -->|yes| J[Insert medical record and link publishedRecordId]

    K[Payment status request] --> L{Verified webhook or mock provider?}
    L -->|no| M[Remain pending]
    L -->|yes| N[Mark succeeded]

    O[Doctor verification] --> P{Registry evidence or named admin?}
    P -->|no| Q[Remain pending]
    P -->|yes| R[Publish bookable profile]
```

## 7. Implemented architecture boundary

```mermaid
flowchart TD
    Client[Browser client] --> Route[Next.js API route handler]
    Route --> Auth[Authenticate and authorize]
    Auth --> Validate[Validate request]
    Validate --> Service[Domain service]
    Service --> Repository[Repository]
    Repository --> DB[(PostgreSQL / Drizzle)]
    Service --> Provider[External provider adapter]
    Provider --> External[(SMS / payment / video / optional LLM)]
    Service --> Audit[Audit and safety event appenders]
    Audit --> DB
    Route -. never writes SQL .-> DB
    Client -. never decides authority .-> DB
```

