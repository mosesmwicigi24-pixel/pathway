// Test data factories. Insert minimal valid rows and return ids/rows so module
// tests can set up state without hand-writing SQL each time.
import { testPool } from "./db.js";

export async function createCongregation(name = "Test Branch", country = "KE"): Promise<string> {
  const { rows } = await testPool().query<{ congregation_id: string }>(
    `INSERT INTO congregations (name, country) VALUES ($1,$2) RETURNING congregation_id`,
    [name, country],
  );
  return rows[0]!.congregation_id;
}

export async function createCellGroup(
  congregationId: string,
  name = "Cell A",
  meetingCadence = 8,
): Promise<string> {
  const { rows } = await testPool().query<{ cell_group_id: string }>(
    `INSERT INTO cell_groups (congregation_id, name, meeting_cadence) VALUES ($1,$2,$3) RETURNING cell_group_id`,
    [congregationId, name, meetingCadence],
  );
  return rows[0]!.cell_group_id;
}

export interface CreateUserOpts {
  congregationId: string;
  cellGroupId?: string;
  role?: "Student" | "Instructor" | "Admin" | "SuperAdmin";
  fullName?: string;
  dateOfBirth?: string; // ISO date
  phone?: string;
  email?: string | null;
}

export async function createUser(opts: CreateUserOpts): Promise<{ user_id: string; is_minor: boolean }> {
  const { rows } = await testPool().query<{ user_id: string; is_minor: boolean }>(
    `INSERT INTO users (full_name, phone_number, date_of_birth, congregation_id, cell_group_id, role, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING user_id, is_minor`,
    [
      opts.fullName ?? "Test Member",
      opts.phone ?? "+254700000000",
      opts.dateOfBirth ?? "1995-01-01",
      opts.congregationId,
      opts.cellGroupId ?? null,
      opts.role ?? "Student",
      opts.email ?? null,
    ],
  );
  return rows[0]!;
}

export async function createEnrollment(userId: string, currentLevel = 1): Promise<string> {
  const { rows } = await testPool().query<{ enrollment_id: string }>(
    `INSERT INTO enrollments (user_id, current_level) VALUES ($1,$2) RETURNING enrollment_id`,
    [userId, currentLevel],
  );
  return rows[0]!.enrollment_id;
}

export async function createModule(
  level: number,
  seq: number,
  opts: {
    title?: string;
    quizPassMark?: number;
    published?: boolean;
    evaluationKind?: "none" | "reflection" | "quiz" | "exit_exam";
  } = {},
): Promise<string> {
  const { rows } = await testPool().query<{ module_id: string }>(
    `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, quiz_pass_mark, status, evaluation_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING module_id`,
    [
      level,
      seq,
      opts.title ?? `L${level} M${seq}`,
      "content",
      opts.quizPassMark ?? 70,
      (opts.published ?? true) ? "published" : "draft",
      opts.evaluationKind ?? "quiz",
    ],
  );
  return rows[0]!.module_id;
}

/** Record enough reading engagement that the server-authoritative content gate
 *  (assembleQuiz / mark-complete) treats the lesson as consumed — the honest
 *  precondition for a member reaching the quiz: read → watch → listen → reflect.
 *  Also writes a reflection by default (the final content step); pass
 *  `reflect: false` to record only engagement (e.g. to assert the reflect gate).
 *  Video/audio seconds optional for media modules. */
export async function markContentConsumed(
  userId: string,
  moduleId: string,
  opts: { reading?: number; video?: number; audio?: number; lastPage?: number; reflect?: boolean } = {},
): Promise<void> {
  await testPool().query(
    `INSERT INTO module_engagement (user_id, module_id, reading_seconds, video_seconds, audio_seconds, last_page)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, module_id) DO UPDATE SET
       reading_seconds = EXCLUDED.reading_seconds, video_seconds = EXCLUDED.video_seconds,
       audio_seconds = EXCLUDED.audio_seconds, last_page = EXCLUDED.last_page`,
    [userId, moduleId, opts.reading ?? 300, opts.video ?? 0, opts.audio ?? 0, opts.lastPage ?? 99],
  );
  if (opts.reflect !== false) await markReflected(userId, moduleId);
}

/** Write a non-empty reflection for (user, module) — the content gate's final
 *  'reflect' step. Creates/reuses the member's module_progress row to anchor the
 *  FK, then upserts the reflection (module_reflections is keyed by progress_id). */
export async function markReflected(
  userId: string,
  moduleId: string,
  body = "A genuine reflection on what this lesson stirred in me.",
): Promise<void> {
  const { rows } = await testPool().query<{ progress_id: string }>(
    `INSERT INTO module_progress (enrollment_id, module_id)
     SELECT enrollment_id, $2 FROM enrollments WHERE user_id = $1
     ON CONFLICT (enrollment_id, module_id) DO UPDATE SET row_version = module_progress.row_version
     RETURNING progress_id`,
    [userId, moduleId],
  );
  await testPool().query(
    `INSERT INTO module_reflections (progress_id, user_id, module_id, body)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (progress_id) DO UPDATE SET body = EXCLUDED.body`,
    [rows[0]!.progress_id, userId, moduleId, body],
  );
}

/** Insert `days` interaction events on distinct recent days (drives the Hᵢ signal). */
export async function addInteractionDays(userId: string, days: number): Promise<void> {
  for (let i = 1; i <= days; i++) {
    await testPool().query(
      `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id)
       VALUES ($1, 'lesson_open', (CURRENT_DATE - ($2 || ' days')::interval), gen_random_uuid())`,
      [userId, i],
    );
  }
}

export async function createLeaderAssignment(leaderUserId: string, cellGroupId: string): Promise<string> {
  const { rows } = await testPool().query<{ assignment_id: string }>(
    `INSERT INTO leader_assignments (leader_user_id, cell_group_id) VALUES ($1,$2) RETURNING assignment_id`,
    [leaderUserId, cellGroupId],
  );
  return rows[0]!.assignment_id;
}

/** Set a cell group's leader (the cell-scope discipler resolution path). */
export async function setCellLeader(cellGroupId: string, leaderUserId: string): Promise<void> {
  await testPool().query(`UPDATE cell_groups SET leader_user_id = $2 WHERE cell_group_id = $1`, [
    cellGroupId,
    leaderUserId,
  ]);
}

/** Explicit 1:1 discipling edge (relationship_tree) — the preferred discipler path. */
export async function createRelationship(multiplierId: string, discipleId: string): Promise<void> {
  await testPool().query(
    `INSERT INTO relationship_tree (multiplier_id, disciple_id) VALUES ($1, $2)
     ON CONFLICT (disciple_id) DO UPDATE SET multiplier_id = EXCLUDED.multiplier_id`,
    [multiplierId, discipleId],
  );
}

/** A pending level advancement — the "awaiting usher" gate (§1.9). */
export async function createPendingLevelAdvancement(userId: string, levelNumber: number): Promise<string> {
  const { rows } = await testPool().query<{ id: string }>(
    `INSERT INTO level_advancements (user_id, level_number, status) VALUES ($1, $2, 'pending')
     ON CONFLICT (user_id, level_number) DO UPDATE SET status = 'pending' RETURNING id`,
    [userId, levelNumber],
  );
  return rows[0]!.id;
}

/** Mark a module completed for a member (creates/reuses the module_progress row). */
export async function completeModule(userId: string, moduleId: string): Promise<void> {
  await testPool().query(
    `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at)
     SELECT enrollment_id, $2, TRUE, now() FROM enrollments WHERE user_id = $1
     ON CONFLICT (enrollment_id, module_id) DO UPDATE SET is_completed = TRUE, completed_at = now()`,
    [userId, moduleId],
  );
}

export async function createEvent(
  congregationId: string,
  opts: { eventId?: string; qrSecret?: string; cellGroupId?: string } = {},
): Promise<{ event_id: string; qr_secret: string }> {
  const eventId = opts.eventId ?? "sunday-service";
  const qrSecret = opts.qrSecret ?? "qr-secret-123";
  await testPool().query(
    `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret)
     VALUES ($1, $2, $3, 'Service', now(), $4)`,
    [eventId, congregationId, opts.cellGroupId ?? null, qrSecret],
  );
  return { event_id: eventId, qr_secret: qrSecret };
}

export async function addQuestion(
  moduleId: string,
  correct: string,
  qType: "MultipleChoice" | "TrueFalse" | "FillInTheBlank" = "MultipleChoice",
  options: string[] = ["A", "B", "C", "D"],
): Promise<string> {
  const { rows } = await testPool().query<{ question_id: string }>(
    `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer)
     VALUES ($1,$2,$3,$4,$5) RETURNING question_id`,
    [moduleId, qType, "Q?", JSON.stringify(options), correct],
  );
  return rows[0]!.question_id;
}

/**
 * Insert a question of any Figma type with explicit storage values. `correct`
 * is the scalar (single-select), a JSON array string (checkbox), or '' (manual).
 */
export async function addTypedQuestion(opts: {
  moduleId: string;
  qType: string;
  correct: string;
  answerOptions?: unknown;
  points?: number;
}): Promise<string> {
  const { rows } = await testPool().query<{ question_id: string }>(
    `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, points)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,1)) RETURNING question_id`,
    [
      opts.moduleId,
      opts.qType,
      "Q?",
      opts.answerOptions !== undefined ? JSON.stringify(opts.answerOptions) : null,
      opts.correct,
      opts.points ?? null,
    ],
  );
  return rows[0]!.question_id;
}

/**
 * A church service (the cadence slot members scan into). `startsAt` defaults to
 * an hour ago so the service already counts toward the streak walk.
 */
export async function createChurchService(
  congregationId: string,
  opts: {
    title?: string;
    serviceDate?: string;
    startsAt?: string;
    qrSecret?: string;
    qrEnabled?: boolean;
    countsForStreak?: boolean;
    checkinOpensAt?: string | null;
    checkinClosesAt?: string | null;
  } = {},
): Promise<{ service_id: string; qr_secret: string }> {
  const startsAt = opts.startsAt ?? new Date(Date.now() - 3_600_000).toISOString();
  const qrSecret = opts.qrSecret ?? "service-secret-123";
  const { rows } = await testPool().query<{ service_id: string }>(
    `INSERT INTO church_services
       (congregation_id, title, service_date, starts_at, qr_secret, qr_enabled,
        counts_for_streak, checkin_opens_at, checkin_closes_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING service_id`,
    [
      congregationId,
      opts.title ?? "Sunday Service",
      opts.serviceDate ?? startsAt.slice(0, 10),
      startsAt,
      qrSecret,
      opts.qrEnabled ?? true,
      opts.countsForStreak ?? true,
      opts.checkinOpensAt ?? null,
      opts.checkinClosesAt ?? null,
    ],
  );
  return { service_id: rows[0]!.service_id, qr_secret: qrSecret };
}
