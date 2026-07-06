-- New Grace: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'new-grace');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Lamentations 3:22–23', 'New Every Morning'),
  (2, 'Exodus 3:11–12', 'The Murderer Who Led an Exodus'),
  (3, 'Psalm 51:10, 12', 'The King Who Fell — and Sang Again'),
  (4, '1 Timothy 1:15–16', 'Exhibit A of Unlimited Patience'),
  (5, '1 Samuel 12:20', 'The Great "Yet"'),
  (6, '2 Corinthians 12:9', 'Power Made Perfect in Weakness'),
  (7, 'John 21:9, 12', 'Breakfast for a Denier'),
  (8, 'Philippians 3:13–14', 'Forgetting What Is Behind'),
  (9, 'Luke 15:20', 'The Father Who Runs'),
  (10, 'Jonah 3:1–2', 'The Word Comes a Second Time')
) AS v(n, ref, title) WHERE p.code = 'new-grace';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'new-grace'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Lamentations 3:22–23', $dev$“The steadfast love of the Lord never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Begin with where these words were written: not in a palace, but in the ashes of a destroyed Jerusalem. Jeremiah wrote “great is your faithfulness” while looking at rubble — much of it caused by his own people's failures. Grace was not denying the ruins. Grace was rising on them like a sunrise.

In Christ, this is your legal position, not just your poetry: “There is now no condemnation for those who are in Christ Jesus” (Romans 8:1). The punishment your failure deserved was fully carried at the cross. What remains for you each morning is not a verdict — it is mercy, newly minted.

You did not exhaust God's grace last night. You cannot. His mercies out-manufacture your failures, every single dawn.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What "rubble" have you been staring at — and can you say "great is Your faithfulness" over it?

— What would you attempt again if this morning's mercy were truly new?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, I receive this morning's mercy — not yesterday's leftovers, but grace made new for today. Over my rubble I declare it: great is Your faithfulness. Amen.

_May this morning's mercy feel as new to you as it actually is._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Lamentations 3:19–26; Romans 8:1–4$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Exodus 3:11–12', $dev$“But Moses said to God, “Who am I that I should go to Pharaoh and bring the Israelites out of Egypt?” And God said, “I will be with you.””$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Moses' résumé at eighty: a killing in his past, a failed first attempt at deliverance, and four decades of hiding in the wilderness. If ever a file looked closed, it was his. Then a bush caught fire.

Notice what God did not do at that bush. He did not review the Egyptian incident. He did not demand an account of the wasted decades. He announced an assignment — as though the future were the only file He was holding.

God uses the ones society calls disqualified; it is one of His signatures. Your failure did not cancel your assignment. In the economy of grace, even your wilderness years were training — Moses spent forty years learning the very desert he would later lead a nation through.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What "Egyptian incident" do you assume disqualified you?

— What did your wilderness season teach you that your palace season never could?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$God of Moses, thank You that You call futures, not files. If You can send a fugitive to free a nation, You can still send me. Here I am. Amen.

_May a bush burn in your wilderness this week — and may you hear your assignment in it._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 2:11–15; 3:1–14; Acts 7:20–36$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Psalm 51:10, 12', $dev$“Create in me a pure heart, O God, and renew a steadfast spirit within me… Restore to me the joy of your salvation.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$David's failure was not a slip; it was a landslide — adultery, deception, and a man's death arranged to hide it. Yet the Bible's verdict over his whole life remains “a man after God's own heart.” How? Not because the sin was small, but because the repentance was real.

Psalm 51 shows us grace's doorway: no excuses, no blame-shifting — “Against you, you only, have I sinned.” David brought God a broken spirit, and discovered the sacrifice God never despises.

And here is the wonder: out of that very failure God brought forth Solomon, and through that family line, the Messiah. Grace does not merely clean up after our failures. Grace composts them — and grows kingdom fruit in the same soil.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Is there a confession you have been negotiating instead of making?

— What might God want to grow in the very soil of your worst season?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, I come like David — no excuses, just a broken and contrite heart. Create in me a pure heart, renew my spirit, and restore to me the joy of Your salvation. Amen.

_May the joy of your salvation be restored to you in full measure._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 51; 2 Samuel 12:1–13$dev$),
  (4, 1, 'scripture', 'Today''s Reading', '1 Timothy 1:15–16', $dev$“Here is a trustworthy saying… Christ Jesus came into the world to save sinners — of whom I am the worst. But for that very reason I was shown mercy so that in me… Christ Jesus might display his immense patience as an example.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Paul never sanitized his past: he had hunted Christians, approved executions, torn families apart. Yet listen to how he understood his own story — I was shown mercy so that Christ might display his immense patience as an example.

Read that again: God made Paul's forgiven past into a public exhibit — Exhibit A of how much patience Christ carries. The worse the record, the brighter the mercy that covers it.

This reframes your history entirely. Your forgiven failure is not the thing you hide; it is the thing heaven displays. Somebody in your future needs to know that a person can fall exactly where you fell and rise by grace. Your testimony is their permission slip.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— What part of your story have you been hiding that heaven may want to display?

— Who might find their hope inside your testimony?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, make my forgiven past an exhibit of Your patience. I will stop editing my story and start testifying to Your mercy. Use it to unlock someone else's hope. Amen.

_May your scars become somebody's map to mercy._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$1 Timothy 1:12–17; Acts 9:1–22$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '1 Samuel 12:20', $dev$“Do not be afraid. You have done all this evil; yet do not turn away from the Lord, but serve the Lord with all your heart.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Israel had just committed a national failure — rejecting God's kingship and demanding a human king. Samuel does not minimize it: “You have done all this evil.” And then comes one of the most beautiful words in Scripture: yet.

Yet do not turn away. Yet serve the Lord with all your heart. Notice the direction of the instruction: failure tempts us to run from God in shame, when grace invites us to run to Him in service. The devil's masterpiece is convincing a fallen believer that distance is humility. It is not; it is defeat.

Whatever your “all this evil” is, heaven has attached a “yet” to it. The way back is not a long probation. It is a turned heart, today.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Has shame been dressing itself up as humility in your life — keeping you distant from God?

— What would "serving the Lord with all your heart" look like, starting this week?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I hear the "yet" over my failure. I refuse the false humility of distance. I turn — not away from You, but toward You — and I give You my whole heart's service. Amen.

_May the word "yet" be written by God over every failure in your story._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 12:19–25$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '2 Corinthians 12:9', $dev$“But he said to me, “My grace is sufficient for you, for my power is made perfect in weakness.” Therefore I will boast all the more gladly about my weaknesses, so that Christ’s power may rest on me.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Paul asked three times for his weakness to be removed. Heaven answered with something better than removal: sufficiency. My grace is sufficient for you — present tense, permanent supply.

Then comes the sentence that turns human thinking upside down: God's power is made perfect in weakness. Not despite it — in it. The crack in your jar is where the treasure shines through (2 Corinthians 4:7). The world builds platforms out of strength; God builds testimonies out of dependence.

So the weakness you have begged God to delete may be the very stage He intends to stand on. Stop negotiating with your thorn long enough to notice the grace growing beside it.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What weakness have you asked God to remove that He may intend to inhabit?

— How would you live differently if dependence were a qualification, not a defect?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Lord, Your grace is sufficient for me — for this thorn, this weakness, this day. Let Your power rest on the cracked places of my life and shine through them. Amen.

_May Christ's power rest visibly on your weakest place._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$2 Corinthians 12:7–10; 4:7–9$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'John 21:9, 12', $dev$“When they landed, they saw a fire of burning coals there with fish on it, and some bread… Jesus said to them, “Come and have breakfast.””$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Peter denied Jesus three times beside a charcoal fire. After the resurrection, Jesus built another charcoal fire — and cooked him breakfast beside it. Read that slowly: the Lord of glory made food for the man who had disowned Him.

Then, three times — once for each denial — Jesus asked, “Do you love me?” and three times He answered Peter's yes with commission: feed my sheep. He did not re-try the case. He re-issued the calling.

This is how Christ handles your failure: not with a tribunal, but with a table. And notice what restoration produced — fifty days later, the denier preached and three thousand were saved. Your restoration is never only about you; sheep are waiting on the other side of it.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where do you need to hear "Come and have breakfast" instead of "Explain yourself"?

— What calling might Jesus be re-issuing to you right now?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I come to Your fire — the one with breakfast on it. I answer Your question: You know that I love You. Re-issue my calling, and I will feed Your sheep. Amen.

_May you smell breakfast, not judgment, when you come back to His fire._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$John 21:1–19; Luke 22:31–32$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Philippians 3:13–14', $dev$“But one thing I do: Forgetting what is behind and straining toward what is ahead, I press on toward the goal to win the prize for which God has called me heavenward in Christ Jesus.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Shame is a rehearsal artist. It replays the failure in high definition, night after night, until the past feels more real than the future. Paul — who had more to replay than most — announces his deliberate policy: forgetting what is behind.

Biblical forgetting is not amnesia; Paul could still list his past when it served the gospel. It is de-throning — refusing to let yesterday govern today. You cannot drive forward staring into the mirror, and the devil knows it; that is why he keeps polishing the glass.

You cannot change the past, and the enemy knows that too — it is precisely why he keeps you facing it. But what God is working on is your future. Cut off your past and march forward.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which scene does shame replay most often — and what does it cost you to keep watching it?

— What is the "one thing" ahead that deserves the energy the past has been consuming?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, I resign as curator of the museum of my failures. I forget what is behind — I de-throne it — and I strain toward what You have called me to. Point my eyes forward. Amen.

_May your windscreen finally grow larger than your mirror._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 3:4–14; Isaiah 43:18–19$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Luke 15:20', $dev$“But while he was still a long way off, his father saw him and was filled with compassion for him; he ran to his son, threw his arms around him and kissed him.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$The prodigal rehearsed a speech on the road home — a proposal for demotion: make me like one of your hired servants. He had done the mathematics of his failure and calculated his reduced worth.

He never finished the speech. The father was running before the boy could present his terms — robe, ring, sandals, feast. In a Middle Eastern village, patriarchs did not run; this father gathered his robes and sprinted, absorbing the village's shame so his son would not have to walk through it alone.

That is your God. While you are still rehearsing your demotion speech, He is already in motion. Grace does not meet you halfway. It outruns you.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What "demotion speech" have you been rehearsing before God?

— Can you let yourself be celebrated — robe and ring — rather than merely tolerated?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, I drop my speech. I receive the robe I did not earn, the ring I do not deserve, and the embrace that outran my repentance. I come home as a child, not an employee. Amen.

_May you hear running footsteps every time you turn toward home._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 15:11–32$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Jonah 3:1–2', $dev$“Then the word of the Lord came to Jonah a second time: “Go to the great city of Nineveh and proclaim to it the message I give you.””$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Jonah ran from his assignment — in the opposite direction, by ship, into a storm, into a fish. If anyone had forfeited his calling, surely it was the prophet found sleeping in the cargo hold of his own disobedience.

Then comes the quietest miracle in the book: the word of the Lord came a second time. Same commission. Same city. Same God — undeterred. And when Jonah finally preached, an entire city repented; his greatest ministry stood on the far side of his greatest failure.

This is your commissioning day. The God of second words is speaking again. Steward this new grace: walk humbly, keep short accounts, extend to others the mercy you have received — and go to your Nineveh.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— What assignment is God re-issuing to you "a second time"?

— Who needs from you the same mercy these ten days have shown you?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$God of the second word, I hear You. I rise from the ash of my failure and I go where You send me. Make my life a testimony that Your mercies are new every morning. Amen.

_May the word of the Lord come to you a second time — and may you run toward it, not away._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Jonah 1–3; Micah 7:8, 18–19$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
