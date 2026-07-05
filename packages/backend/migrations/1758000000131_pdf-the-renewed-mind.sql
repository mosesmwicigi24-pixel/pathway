-- The Renewed Mind: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'the-renewed-mind');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Matthew 17:2', 'The Mountain Where the Word Was Coined'),
  (2, '2 Corinthians 10:4–5', 'The Battlefield Between Your Ears'),
  (3, 'Ephesians 4:23', 'Your Mind Has a Posture'),
  (4, 'Jeremiah 17:9', 'Why Education Is Not Enough'),
  (5, 'Titus 3:5', 'The Renewer Himself'),
  (6, '2 Corinthians 3:18', 'Beholding Is Becoming'),
  (7, '2 Corinthians 3:6', 'Not a New List — a New Life'),
  (8, '2 Corinthians 10:5', 'Arrest Every Thought'),
  (9, 'Philippians 4:8', 'Replace — Don''t Just Resist'),
  (10, 'Proverbs 4:23', 'Guard the Gates'),
  (11, 'Joshua 1:8', 'Meditation: Digesting the Word'),
  (12, 'Matthew 13:31–32', 'One Thought Is All It Takes'),
  (13, 'Proverbs 23:7', 'Your Mentality Is Your Reality'),
  (14, 'Ephesians 3:20', 'Sanctified Imagination'),
  (15, 'Romans 12:2b', 'The Renewed Mind Discerns the Will of God')
) AS v(n, ref, title) WHERE p.code = 'the-renewed-mind';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'the-renewed-mind'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'Matthew 17:2',        $dev$“There he was transfigured before them. His face shone like the sun, and his clothes became as white as the light.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,                  $dev$Begin where the word begins. “Be transformed” in Romans 12:2 is metemorphōthē — the same word the gospels use for one event only: Jesus on the mountain of transfiguration, glory breaking through from within until His face shone.

Mark the magnitude, because it sets the ceiling for this whole plan. When God speaks of transforming your mind, He is not offering new manners or a tidier attitude. He is offering the family miracle: inward glory becoming outward reality. “Then the righteous will shine like the sun in the kingdom of their Father” (Matthew 13:43).

Fifteen days from now you will not merely think more positively. You will be further along the road of transfiguration — and the Christ who shone on that mountain is Himself the light you will be filled with.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— What have you been expecting from God — adjustment or transfiguration?

— Where in your thinking do you most long for glory to break through?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,                  $dev$Lord Jesus, You shone on the mountain — and You offer transformation from the same root. Set my expectation high: begin transfiguring my mind from within. Amen.

_May the ceiling of your expectation rise to the height of His promise._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,                  $dev$Matthew 17:1–8; Romans 12:1–2$dev$),
  (2, 1, 'scripture',  'Today''s Reading', '2 Corinthians 10:4–5', $dev$“The weapons we fight with… have divine power to demolish strongholds. We demolish arguments and every pretension that sets itself up against the knowledge of God, and we take captive every thought to make it obedient to Christ.”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,                  $dev$Every visible battle in your life was first a battle in your thinking. Paul names the enemy's fortifications precisely: arguments, pretensions, strongholds — established patterns of thought that defend themselves like walled cities.

You know your strongholds by their age and their armor: the interpretations you have held so long they feel like eyesight itself. Nothing works for me. I am what happened to me. People always leave.

But read the good news in the verse: divine power to demolish. Not manage, not decorate — demolish. This plan is a demolition-and-construction contract, and the Contractor has never lost a job. Today, simply survey the site: name your oldest stronghold without shame. Marked walls fall first.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— Which thought-pattern in you is so old it feels like eyesight?

— What would your life look like with that wall gone?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,                  $dev$Father, I open the site to You. Here are my walls — the arguments and old interpretations. I believe in divine power to demolish. Begin the demolition. Amen.

_May the oldest wall in your thinking hear its first crack today._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,                  $dev$2 Corinthians 10:3–5$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Ephesians 4:23',      $dev$“Be made new in the attitude of your minds.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,                  $dev$Here is a discovery that explains years of frustration: the mind does not merely hold views; it holds a viewpoint. Paul says “be renewed in the spirit of your mind” — the mind has a spirit, a posture, a bearing, a lean. Two people receive identical news; one's mind leans toward hope, the other's toward doom. Same facts, different posture.

This is why information alone never transformed anyone. You can pour right facts into a wrongly-postured mind and it will bend them all toward the old conclusion — like water finding the old riverbed.

So renewal aims deeper than your opinions; it aims at your lean. And leans can be retrained: what you behold, rehearse and thank God for, day after day, slowly becomes the new direction your mind falls toward. We are not changing your answers first. We are changing your tilt.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— Which way does your mind lean when news is neutral — toward hope or toward dread?

— Where did that lean come from?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,                  $dev$Father, renew not only my thoughts but my tilt. Retrain the posture of my mind until hope is the direction I naturally fall. Amen.

_May your mind learn to lean, all by itself, toward hope._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,                  $dev$Ephesians 4:20–24$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Jeremiah 17:9',       $dev$“The heart is deceitful above all things and beyond cure. Who can understand it?”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,                  $dev$Many believe the mind's only problem is missing information — educate people enough and society will heal itself. But look honestly around: education has also produced brilliant fraudsters, learned schemers and eloquent deceivers. The problem of the mind is deeper than ignorance.

Scripture's diagnosis is humbling: our minds are not merely finite — they are fallen. Left to themselves they resist seeing God as more worthy than ourselves and our projects. You know this of your own mind by a simple test: how little effort it takes to think about yourself, and how much it takes to fix your thoughts on God.

But every honest diagnosis in the gospel is a doorway to grace. What education cannot reach, the Spirit can — and tomorrow we meet the Renewer Himself. Today, simply agree with the Physician: my mind needs more than information. It needs renewal.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— Where have you hoped that knowledge alone would change you — and found it didn't?

— What does the "effort test" reveal about your mind's natural direction?$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,                  $dev$Father, I agree with Your diagnosis: my mind needs renewal, not just data. I bring You the patient. Heal what information could not. Amen.

_May honest diagnosis open the door to deep healing this week._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,                  $dev$Jeremiah 17:9–10; Romans 1:21–25$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Titus 3:5',           $dev$“He saved us… through the washing of rebirth and renewal by the Holy Spirit.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,                  $dev$Whose work is the renewal of your mind? Before it is ever yours, it is His. The only other place Scripture uses Romans 12:2's word “renewal” is here — renewal by the Holy Spirit. The Spirit renews the mind; it is first and decisively His work.

And He works in two directions at once. From the outside in: He brings your mind under Christ-exalting truth — the Word read, preached, meditated. From the inside out: He softens the hard heart that would otherwise reject that truth. Truth without a softened heart is refused; a softened heart without truth has nothing to embrace. He supplies both.

Feel the relief of this: you are not the engine of your transformation — you are the site of it. Your part, which the coming days will train, is glad cooperation with a Worker who never abandons a project.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— Have you been straining as the engine of your own change, or cooperating with the Worker?

— Which do you need more today — truth for the mind, or softening for the heart?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,                  $dev$Holy Spirit, Renewer of minds, I hand You the project. Work from the outside in with truth, and from the inside out with tenderness — and teach me to cooperate. Amen.

_May you feel the relief of being a building site, not a builder, today._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,                  $dev$Titus 3:4–7; Ezekiel 36:26–27$dev$),
  (6, 1, 'scripture',  'Today''s Reading', '2 Corinthians 3:18',  $dev$“And we all, who with unveiled faces contemplate the Lord’s glory, are being transformed into his image with ever-increasing glory, which comes from the Lord, who is the Spirit.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,                  $dev$Here is the Spirit's method, in one verse: transformation happens by beholding. As we contemplate the glory of the Lord, we are changed into what we gaze at — from one degree of glory to another. Beholding is becoming.

This is a universal law you have already lived under: whatever your mind beholds daily has been shaping you all along — the news you soak in, the feeds you scroll, the fears you rehearse. Nobody escapes the law; we only choose our object.

So the strategy of renewal is gloriously simple: give your gaze to Christ. Read the gospels slowly and watch Him. Worship with attention. Meditate on His kindness, His courage, His cross. The mind that beholds Jesus daily is being renovated by what it watches — and the change arrives the way sunrise does: gradually, then unmistakably.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— What has your mind been beholding most this month — and what is it making of you?

— How will you build a daily "gaze window" for beholding Christ?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,                  $dev$Lord, I choose my gaze. Unveil my face before Your glory daily, and change me by what I watch — from one degree of glory to another. Amen.

_May what you behold this week begin, visibly, to become you._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,                  $dev$2 Corinthians 3:12–18; Hebrews 12:1–2$dev$),
  (7, 1, 'scripture',  'Today''s Reading', '2 Corinthians 3:6',   $dev$“For the letter kills, but the Spirit gives life.”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,                  $dev$Beware the counterfeit of renewal: swapping the to-do list of the flesh for the to-do list of religion. A man can cancel every worldly behavior and remain untransformed — same heart, new rules; the cage repainted, the bird unchanged.

Watch Paul's logic: when he lists the works of the flesh, he does not answer them with works of law — he answers with the fruit of the Spirit (Galatians 5:19–22). Works are manufactured; fruit is grown. Lists press from the outside; life pushes from the inside.

This is the dignity of what God is doing in you: not behavior management but nature change — “a profound, Spirit-wrought change from the inside out.” So measure your progress by the right meter. The question is not only “what did I avoid this week?” but “what is growing in me?” Love. Joy. Peace. The orchard is the evidence.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— Where has your Christianity been list-keeping rather than fruit-growing?

— Which fruit of the Spirit is visibly growing in you this season? Which is budding?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,                  $dev$Father, save me from the repainted cage. Grow Your fruit in me from the inside out, and let my life be evidence of a changed nature, not a managed one. Amen.

_May something sweet and unmistakable grow in your orchard this month._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,                  $dev$Galatians 5:16–25; 2 Corinthians 3:4–6$dev$),
  (8, 1, 'scripture',  'Today''s Reading', '2 Corinthians 10:5',  $dev$“…we take captive every thought to make it obedient to Christ.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,                  $dev$Now your part of the work begins, and it starts with an arrest warrant. “Take captive every thought” — the picture is military: a checkpoint at the border of your mind, where thoughts are stopped, questioned and processed before they settle.

Most thoughts enter unexamined. They arrive dressed as your own voice, claiming citizenship — but many are foreigners: suggestions of the enemy, echoes of old wounds, moods masquerading as facts. The renewal discipline is to audit them. Pay attention to your recurring thoughts; write them down if you must. A thought must first be arrested before it can be tried.

Try each one against a simple standard: does this thought agree with what God says? If yes, give it residence. If no, escort it to the border in Jesus' name. You are not the helpless audience of your mind. You are its gatekeeper.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— What recurring thought has been living in you unexamined — claiming to be your own voice?

— Arrest it today: write it down and try it against the Word. Verdict?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,                  $dev$Lord, I set up the checkpoint. Every thought will show its papers. Give me alertness to arrest, wisdom to try, and authority to deport — in Jesus' name. Amen.

_May your border posts stay manned and your inner city stay at peace._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,                  $dev$2 Corinthians 10:5; Psalm 19:14$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Philippians 4:8',     $dev$“Finally, brothers and sisters, whatever is true, whatever is noble, whatever is right, whatever is pure, whatever is lovely, whatever is admirable — if anything is excellent or praiseworthy — think about such things.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,                  $dev$Here is why sheer resistance fails: a vacant mind is a contested plot. Jesus told of a house swept clean and left empty — and the evicted spirit returned with seven worse companions (Matthew 12:43–45). Emptiness is not victory; it is a vacancy notice.

The Bible's method is substitution. Every time a wrong thought is evicted, a right one must be installed in its room — this is the Law of Substitution, and Philippians 4:8 is the furniture catalogue: the true, the noble, the pure, the lovely.

So prepare your replacements in advance. For every recurring lie you arrested yesterday, write its scriptural replacement today and keep it within reach. The fastest way out of a wrong thought is not fighting it in its own room — it is walking into a better one.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,                  $dev$— Which arrested thought still has an empty room behind it?

— Write the Philippians 4:8 replacement you will install — word for word.$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,                  $dev$Father, I refuse to leave swept rooms empty. Fill every vacancy with what is true, noble, pure and lovely — and teach me to change rooms quickly. Amen.

_May every evicted lie find its room already occupied by truth._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,                  $dev$Philippians 4:8–9; Matthew 12:43–45$dev$),
  (10, 1, 'scripture',  'Today''s Reading', 'Proverbs 4:23',      $dev$“Above all else, guard your heart, for everything you do flows from it.”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,                 $dev$Whatever feeds your mind is farming your mind. Your eyes and ears are gates, and everything passing through them daily is planting something — the news you soak in, the music that loops, the conversations you sit in, the accounts you follow at midnight.

Much of what we call weakness of willpower is really carelessness at the gates: we lose the battle at intake and wonder why we lose it at output. What you focus on multiplies — so your inputs are not entertainment; they are agriculture.

Take a gate inventory this week, without condemnation and without mercy: What enters daily? What does it plant? Then farm deliberately — unfollow, mute, add, subscribe, choose. Solomon put it “above all else” for a reason: the guarded heart is the source of everything else you are trying to fix.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— Which gate is least guarded — eyes, ears, or company?

— Name one input you will remove and one you will plant this week.$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, I station watchmen at my gates. Let what enters my eyes and ears this week be seed I would gladly harvest. Amen.

_May your gates admit only what your future will thank you for._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Proverbs 4:20–27; Psalm 101:2–3$dev$),
  (11, 1, 'scripture',  'Today''s Reading', 'Joshua 1:8',         $dev$“Keep this Book of the Law always on your lips; meditate on it day and night… Then you will be prosperous and successful.”$dev$),
  (11, 2, 'devotional', 'Devotional',       NULL,                 $dev$Reading passes food across the plate; meditation absorbs it into the bloodstream. This is why one man reads a whole chapter and remains unchanged, while another carries a single verse through his day like a sweet in his mouth — and is transformed.

God attached Joshua's success not to talent or connections but to a meditation habit: day and night, the Word on his lips. Biblical meditation is not emptying the mind but filling it — turning a verse over, questioning it, speaking it, imagining obeying it, until truth stops being information and becomes nourishment.

Truth in itself may not free you until it is sequentially arranged and deeply received; one truth builds upon another. So take one verse each morning this week. Read it, think it; read it, ponder it — squeeze its virtue like juice from an orange — and carry it until night.$dev$),
  (11, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— What is the difference in you between weeks you merely read and weeks you meditate?

— Which verse will be today's "sweet in the mouth"?$dev$),
  (11, 4, 'devotional', 'Pray',             NULL,                 $dev$God of Joshua, teach me to digest, not just taste. One verse at a time, day and night, let Your Word enter my bloodstream and change my life's chemistry. Amen.

_May today's verse still be sweet on your tongue at midnight._$dev$),
  (11, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Joshua 1:6–9; Psalm 1:1–3$dev$),
  (12, 1, 'scripture',  'Today''s Reading', 'Matthew 13:31–32',   $dev$“The kingdom of heaven is like a mustard seed, which a man took and planted in his field. Though it is the smallest of all seeds, yet when it grows, it is the largest of garden plants.”$dev$),
  (12, 2, 'devotional', 'Devotional',       NULL,                 $dev$Never despise the size of a single thought. One thought — planted, watered, obeyed — can reorganize an entire life. Abraham received one thought under a night sky (“so shall your offspring be”) and it carried him for twenty-five years. One thought from a burning bush emptied Egypt of a nation.

The kingdom itself works on mustard-seed mathematics: smallest of seeds, largest of plants. Every enterprise, every reformation, every restored family began as one idea in one mind that refused to let it die.

This is also why the enemy contests your thoughts so early — he fights seeds because he fears forests. Somewhere in your recent prayer and reading, God may have already planted the thought your next decade will grow from. Handle your impressions from Him with reverence: write them down, water them in prayer, and act on the first small obedience.$dev$),
  (12, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— What God-planted thought have you been carrying lightly that deserves reverence?

— What is its first small obedience?$dev$),
  (12, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, make me a careful farmer of holy thoughts. The seed You have planted — I will write it, water it and walk it out until it towers. Amen.

_May one mustard seed of a thought grow into shade for many after you._$dev$),
  (12, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Matthew 13:31–33; Genesis 15:5–6; Habakkuk 2:2$dev$),
  (13, 1, 'scripture',  'Today''s Reading', 'Proverbs 23:7',      $dev$“For as he thinketh in his heart, so is he.”$dev$),
  (13, 2, 'devotional', 'Devotional',       NULL,                 $dev$Twelve spies toured the same land, tasted the same grapes, measured the same giants. Ten reported: “We seemed like grasshoppers in our own eyes — and we looked the same to them.” Two reported: “We can certainly do it.” Same facts; two mentalities; and each group received exactly the reality its mind had chosen. The grasshopper generation died within reach of the promise; the other mentality entered it.

Mark the terrible sequence in their words: in our own eyes first, “to them” second. The world largely takes you at your inner valuation. Your mentality is your reality.

But mentalities are not fate — they are habits of thought, and these fifteen days have been rebuilding yours. Where you sized yourself as a grasshopper — in the room, in the market, in the calling — heaven files a different measurement. Adopt heaven's arithmetic: not “how big is the giant?” but “how big is my God?”$dev$),
  (13, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— In which arena do you still measure yourself a grasshopper?

— What is heaven's measurement of you in that same arena?$dev$),
  (13, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, I resign from the grasshopper mentality. Give me the spirit of Caleb — a different spirit — that follows You fully and measures giants against You. Amen.

_May you enter, in your lifetime, every promise the grasshopper mind would have forfeited._$dev$),
  (13, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Numbers 13:26–14:9; Proverbs 23:7$dev$),
  (14, 1, 'scripture',  'Today''s Reading', 'Ephesians 3:20',     $dev$“Now to him who is able to do immeasurably more than all we ask or imagine, according to his power that is at work within us…”$dev$),
  (14, 2, 'devotional', 'Devotional',       NULL,                 $dev$God built into man a power so great that heaven itself testified of it at Babel: “nothing they plan to do will be impossible for them” (Genesis 11:6). That power is imagination — the mind's ability to travel into what is not yet seen, survey it, and return to build it. Every invention around you made that journey: first a picture in someone's mind, then a thing in the world.

Like every power, imagination serves whoever employs it. Fear employs it to produce anxiety — vivid films of futures God never wrote. Faith employs it to see what God has promised before it arrives: Abraham counting stars, seeing his descendants.

So do not amputate your imagination — sanctify it. Dare to dream again. Let Scripture, not dread, supply its pictures. Imagine yourself obeying, serving, becoming — and note today's verse: He is able to exceed even that. Your best imagination is still an underestimate.$dev$),
  (14, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— Has your imagination been employed lately by fear or by faith?

— What God-aligned picture of your future will you deliberately hold this week?$dev$),
  (14, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, I take my imagination back from fear and I hire it out to faith. Fill it with pictures worthy of Your promises — and then exceed them. Amen.

_May your redeemed imagination out-dream your history — and still fall short of what He does._$dev$),
  (14, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Ephesians 3:14–21; Genesis 15:5$dev$),
  (15, 1, 'scripture',  'Today''s Reading', 'Romans 12:2b',       $dev$“Then you will be able to test and approve what God’s will is — his good, pleasing and perfect will.”$dev$),
  (15, 2, 'devotional', 'Devotional',       NULL,                 $dev$We end where Romans 12:2 ends — at its purpose clause. Why does God renew minds? So that you will be able to test and approve what God's will is. The renewed mind becomes an instrument of discernment: it recognizes God's will the way a trained ear recognizes true pitch.

This is the practical harvest of your fifteen days: decisions will change. Guidance will feel less like guessing, because a mind soaked in the Word begins to think in the grain of the Author. Confusion loses its grip where renewal has done its work.

So take the workshop with you: behold Christ daily; man the checkpoint; substitute, guard, meditate; reverence holy thoughts; refuse grasshopper measurements; dream with a sanctified imagination. When a mind is transformed to a particular level, you are ushered into a different level of life. Keep ascending — from glory to glory.$dev$),
  (15, 3, 'talk',       'Talk it Over',     NULL,                 $dev$— Which of the workshop disciplines will you keep permanently — name three?

— What decision before you now looks different through a renewing mind?$dev$),
  (15, 4, 'devotional', 'Pray',             NULL,                 $dev$Father, finish what You began: a mind so renewed it recognizes Your will on sight. I keep the disciplines; You keep the transformation — from glory to glory. Amen.

_May the will of God become the easiest thing in the world for your renewed mind to recognize._$dev$),
  (15, 5, 'reading',    'Go Deeper',        NULL,                 $dev$Romans 12:1–2; Colossians 3:1–2$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
