-- Migration 191 · Index every cascade path out of a parent row
-- ============================================================================
-- Found by the 2026-08-13 architectural audit.
--
-- Postgres does NOT create an index for a foreign key — only for the primary
-- key it points at. So a child table whose FK column is unindexed can only be
-- searched by sequential scan, and every ON DELETE CASCADE / SET NULL has to
-- search it.
--
-- Deleting ONE user meant scanning 45 tables. Deleting a congregation, a
-- module, a quiz attempt, a reading plan — each the same shape. Right now the
-- tables are small enough that nobody notices; the scan cost grows with the
-- table, not with the number of rows being deleted, so the first time it hurts
-- will be the time it matters most: a member exercising their right to be
-- deleted, on a database with real history in it.
--
-- The rule applied here is narrow and mechanical: every SINGLE-COLUMN foreign
-- key declared ON DELETE CASCADE or ON DELETE SET NULL that has no index
-- starting with that column gets one. Foreign keys with NO ACTION are left
-- alone — nothing walks them on delete, so an index there would be write cost
-- with no read to pay for it.
--
-- The statements below were generated from the live catalog rather than typed,
-- so the list cannot drift from what the constraints actually say. 63 of them.
-- test/migration-hygiene.test.ts and the FK-index assertion added alongside
-- this migration keep the rule true for constraints added later.

-- Up Migration

CREATE INDEX IF NOT EXISTS idx_app_screen_events_user_id ON app_screen_events (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_congregation_id ON chat_broadcasts (congregation_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_created_by ON chat_conversations (created_by);
CREATE INDEX IF NOT EXISTS idx_chat_members_status_changed_by ON chat_members (status_changed_by);
CREATE INDEX IF NOT EXISTS idx_chat_messages_author_user_id ON chat_messages (author_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_hidden_by ON chat_messages (hidden_by);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_id ON chat_messages (reply_to_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_user_id ON chat_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_connection_requests_decided_by ON connection_requests (decided_by);
CREATE INDEX IF NOT EXISTS idx_connection_requests_requester_id ON connection_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_content_reactions_user_id ON content_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_devotional_reflections_devotional_id ON devotional_reflections (devotional_id);
CREATE INDEX IF NOT EXISTS idx_discipler_assignments_assigned_by ON discipler_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_event_moments_created_by ON event_moments (created_by);
CREATE INDEX IF NOT EXISTS idx_event_post_reactions_user_id ON event_post_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_event_posts_author_user_id ON event_posts (author_user_id);
CREATE INDEX IF NOT EXISTS idx_event_posts_hidden_by ON event_posts (hidden_by);
CREATE INDEX IF NOT EXISTS idx_event_series_follows_series_id ON event_series_follows (series_id);
CREATE INDEX IF NOT EXISTS idx_leader_assignments_cell_group_id ON leader_assignments (cell_group_id);
CREATE INDEX IF NOT EXISTS idx_level_advancements_exam_attempt_id ON level_advancements (exam_attempt_id);
CREATE INDEX IF NOT EXISTS idx_liturgy_recordings_recorded_by ON liturgy_recordings (recorded_by);
CREATE INDEX IF NOT EXISTS idx_live_stream_guests_user_id ON live_stream_guests (user_id);
CREATE INDEX IF NOT EXISTS idx_live_stream_hands_user_id ON live_stream_hands (user_id);
CREATE INDEX IF NOT EXISTS idx_live_stream_messages_user_id ON live_stream_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_live_stream_reactions_user_id ON live_stream_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_live_viewers_user_id ON live_viewers (user_id);
CREATE INDEX IF NOT EXISTS idx_memory_verse_progress_memory_verse_id ON memory_verse_progress (memory_verse_id);
CREATE INDEX IF NOT EXISTS idx_message_reports_reporter_user_id ON message_reports (reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_module_voice_notes_author_user_id ON module_voice_notes (author_user_id);
CREATE INDEX IF NOT EXISTS idx_module_voice_notes_congregation_id ON module_voice_notes (congregation_id);
CREATE INDEX IF NOT EXISTS idx_moment_blessings_user_id ON moment_blessings (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user_id ON oauth_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_assessments_user_id ON onboarding_assessments (user_id);
CREATE INDEX IF NOT EXISTS idx_pastor_assignments_assigned_by ON pastor_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_plan_day_talk_likes_user_id ON plan_day_talk_likes (user_id);
CREATE INDEX IF NOT EXISTS idx_plan_day_talk_posts_user_id ON plan_day_talk_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_prayer_nudges_user_id ON prayer_nudges (user_id);
CREATE INDEX IF NOT EXISTS idx_prayer_wall_comments_author_user_id ON prayer_wall_comments (author_user_id);
CREATE INDEX IF NOT EXISTS idx_prayer_wall_posts_author_user_id ON prayer_wall_posts (author_user_id);
CREATE INDEX IF NOT EXISTS idx_prayer_wall_posts_hidden_by ON prayer_wall_posts (hidden_by);
CREATE INDEX IF NOT EXISTS idx_prayer_wall_reactions_user_id ON prayer_wall_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_module_id ON question_bank (module_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt_id ON quiz_attempt_answers (attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_progress_id ON quiz_attempts (progress_id);
CREATE INDEX IF NOT EXISTS idx_quiz_remediations_attempt_id ON quiz_remediations (attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_remediations_module_id ON quiz_remediations (module_id);
CREATE INDEX IF NOT EXISTS idx_radio_listeners_user_id ON radio_listeners (user_id);
CREATE INDEX IF NOT EXISTS idx_radio_program_tracks_track_id ON radio_program_tracks (track_id);
CREATE INDEX IF NOT EXISTS idx_reading_plan_day_reflections_plan_id ON reading_plan_day_reflections (plan_id);
CREATE INDEX IF NOT EXISTS idx_reading_plan_progress_plan_id ON reading_plan_progress (plan_id);
CREATE INDEX IF NOT EXISTS idx_reading_plan_segment_progress_segment_id ON reading_plan_segment_progress (segment_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_shared_plan_invites_accepted_by ON shared_plan_invites (accepted_by);
CREATE INDEX IF NOT EXISTS idx_shared_plan_invites_invitee_user_id ON shared_plan_invites (invitee_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_plan_invites_inviter_id ON shared_plan_invites (inviter_id);
CREATE INDEX IF NOT EXISTS idx_space_join_requests_decided_by ON space_join_requests (decided_by);
CREATE INDEX IF NOT EXISTS idx_space_join_requests_user_id ON space_join_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_space_roles_granted_by ON space_roles (granted_by);
CREATE INDEX IF NOT EXISTS idx_space_roles_user_id ON space_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_connections_blocked_by ON user_connections (blocked_by);
CREATE INDEX IF NOT EXISTS idx_video_progress_media_asset_id ON video_progress (media_asset_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_id ON webauthn_challenges (user_id);

-- Down Migration
DROP INDEX IF EXISTS idx_app_screen_events_user_id;
DROP INDEX IF EXISTS idx_chat_broadcasts_congregation_id;
DROP INDEX IF EXISTS idx_chat_conversations_created_by;
DROP INDEX IF EXISTS idx_chat_members_status_changed_by;
DROP INDEX IF EXISTS idx_chat_messages_author_user_id;
DROP INDEX IF EXISTS idx_chat_messages_hidden_by;
DROP INDEX IF EXISTS idx_chat_messages_reply_to_id;
DROP INDEX IF EXISTS idx_chat_reactions_user_id;
DROP INDEX IF EXISTS idx_connection_requests_decided_by;
DROP INDEX IF EXISTS idx_connection_requests_requester_id;
DROP INDEX IF EXISTS idx_content_reactions_user_id;
DROP INDEX IF EXISTS idx_devotional_reflections_devotional_id;
DROP INDEX IF EXISTS idx_discipler_assignments_assigned_by;
DROP INDEX IF EXISTS idx_event_moments_created_by;
DROP INDEX IF EXISTS idx_event_post_reactions_user_id;
DROP INDEX IF EXISTS idx_event_posts_author_user_id;
DROP INDEX IF EXISTS idx_event_posts_hidden_by;
DROP INDEX IF EXISTS idx_event_series_follows_series_id;
DROP INDEX IF EXISTS idx_leader_assignments_cell_group_id;
DROP INDEX IF EXISTS idx_level_advancements_exam_attempt_id;
DROP INDEX IF EXISTS idx_liturgy_recordings_recorded_by;
DROP INDEX IF EXISTS idx_live_stream_guests_user_id;
DROP INDEX IF EXISTS idx_live_stream_hands_user_id;
DROP INDEX IF EXISTS idx_live_stream_messages_user_id;
DROP INDEX IF EXISTS idx_live_stream_reactions_user_id;
DROP INDEX IF EXISTS idx_live_viewers_user_id;
DROP INDEX IF EXISTS idx_memory_verse_progress_memory_verse_id;
DROP INDEX IF EXISTS idx_message_reports_reporter_user_id;
DROP INDEX IF EXISTS idx_module_voice_notes_author_user_id;
DROP INDEX IF EXISTS idx_module_voice_notes_congregation_id;
DROP INDEX IF EXISTS idx_moment_blessings_user_id;
DROP INDEX IF EXISTS idx_oauth_identities_user_id;
DROP INDEX IF EXISTS idx_onboarding_assessments_user_id;
DROP INDEX IF EXISTS idx_pastor_assignments_assigned_by;
DROP INDEX IF EXISTS idx_plan_day_talk_likes_user_id;
DROP INDEX IF EXISTS idx_plan_day_talk_posts_user_id;
DROP INDEX IF EXISTS idx_prayer_nudges_user_id;
DROP INDEX IF EXISTS idx_prayer_wall_comments_author_user_id;
DROP INDEX IF EXISTS idx_prayer_wall_posts_author_user_id;
DROP INDEX IF EXISTS idx_prayer_wall_posts_hidden_by;
DROP INDEX IF EXISTS idx_prayer_wall_reactions_user_id;
DROP INDEX IF EXISTS idx_push_tokens_user_id;
DROP INDEX IF EXISTS idx_question_bank_module_id;
DROP INDEX IF EXISTS idx_quiz_attempt_answers_attempt_id;
DROP INDEX IF EXISTS idx_quiz_attempts_progress_id;
DROP INDEX IF EXISTS idx_quiz_remediations_attempt_id;
DROP INDEX IF EXISTS idx_quiz_remediations_module_id;
DROP INDEX IF EXISTS idx_radio_listeners_user_id;
DROP INDEX IF EXISTS idx_radio_program_tracks_track_id;
DROP INDEX IF EXISTS idx_reading_plan_day_reflections_plan_id;
DROP INDEX IF EXISTS idx_reading_plan_progress_plan_id;
DROP INDEX IF EXISTS idx_reading_plan_segment_progress_segment_id;
DROP INDEX IF EXISTS idx_refresh_tokens_user_id;
DROP INDEX IF EXISTS idx_shared_plan_invites_accepted_by;
DROP INDEX IF EXISTS idx_shared_plan_invites_invitee_user_id;
DROP INDEX IF EXISTS idx_shared_plan_invites_inviter_id;
DROP INDEX IF EXISTS idx_space_join_requests_decided_by;
DROP INDEX IF EXISTS idx_space_join_requests_user_id;
DROP INDEX IF EXISTS idx_space_roles_granted_by;
DROP INDEX IF EXISTS idx_space_roles_user_id;
DROP INDEX IF EXISTS idx_user_connections_blocked_by;
DROP INDEX IF EXISTS idx_video_progress_media_asset_id;
DROP INDEX IF EXISTS idx_webauthn_challenges_user_id;
