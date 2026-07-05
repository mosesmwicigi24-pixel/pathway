-- Reseed new-grace with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

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
  (1, 2, 'devotional', 'Devotional', NULL, $dev$There is a specific loneliness to 2 a.m. — the hour when the house is quiet and the failure is loud, and something inside you keeps pressing rewind on the worst thing you ever did. You already know that voice. It preaches the same sermon every night: you had your chance, and you wasted it.

But look at where today's words were actually written. Jeremiah did not compose "great is your faithfulness" from a mountaintop. He wrote it in Lamentations — sitting in the smoking rubble of a destroyed Jerusalem, much of it the wreckage of his own people's choices. Grace was not pretending the ruins weren't there. Grace was rising over them anyway, like a sunrise that does not consult the damage before it dawns.

Here is the truth the morning is trying to teach you: God's mercies are not recycled. They are "new every morning" — manufactured fresh, on purpose, for exactly today's need. And in Christ this is more than comfort; it is your legal standing. "There is now no condemnation for those who are in Christ Jesus" (Romans 8:1). The full penalty your failure earned was carried, in your place, at the cross. So what waits for you at dawn is not a verdict still being deliberated — it is mercy, freshly minted, already yours.

Which means you did not use up God's grace last night. You cannot. His mercy out-manufactures your failure every single morning, and it will still be doing so long after you have run out of ways to disappoint Him. So bring the rubble. Say the honest thing over it — great is Your faithfulness — and let the sun come up.

You are not standing at the end of your chance. You are standing at the front of a brand-new supply.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What "rubble" have you been staring at — and could you say "great is Your faithfulness" over it before the ashes cool?

— What would you attempt again if you truly believed this morning's mercy were brand new and not last night's leftovers?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Father, I receive this morning's mercy — not yesterday's leftovers, but grace made new for today. I hand You the failure I keep replaying and the ruins it left behind. Over all of it I declare what is true: great is Your faithfulness. Amen.

_May this morning's mercy feel as new to you as it actually is._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Lamentations 3:19–26; Romans 8:1–4$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Exodus 3:11–12', $dev$“But Moses said to God, “Who am I that I should go to Pharaoh and bring the Israelites out of Egypt?” And God said, “I will be with you.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$Read Moses' résumé at eighty and you would not hire him. A killing in his past. A first attempt at rescue that ended in a fresh grave and a panicked run. Then forty years of silence, tending someone else's sheep in the back of a desert. If a life ever looked closed and filed away, it was this one.

Then a bush caught fire and would not burn up. And watch closely what God does not do at that bush. He does not open the Egyptian file. He does not demand an accounting of the four wasted decades. He does not make Moses grovel through his history before He'll speak. He simply announces an assignment — as though the only file in His hand were the future.

This is one of God's signatures, printed all over Scripture: He calls the ones the world has stamped "disqualified." "God chose the weak things of the world to shame the strong" (1 Corinthians 1:27). Your failure did not cancel your assignment; heaven does not tie the two together the way shame insists it must. And notice the strange mercy hidden in the wasted years — those forty desert decades were not a detour. They were training. Moses spent them learning the very wilderness he would one day lead a whole nation through.

So the season you have written off as lost time may be the exact terrain God is preparing to use. The fugitive became the deliverer. The dropout became the leader. The one who fled Egypt in fear returned to it with a staff and a promise: "I will be with you."

God is not reviewing your file. He is issuing your assignment. The only question left is the one Moses finally answered with his feet.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What "Egyptian incident" have you quietly assumed disqualified you from anything God might ask?

— What did a wilderness season teach you that no comfortable season ever could — and how might God want to use it?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$God of Moses, thank You that You call futures, not files. If You can send a fugitive to free a nation, You can still send me — desert years and all. I stop hiding behind my history. Here I am. Amen.

_May a bush burn in your wilderness this week — and may you hear your assignment in it._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Exodus 2:11–15; 3:1–14; Acts 7:20–36$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Psalm 51:10, 12', $dev$“Create in me a pure heart, O God, and renew a steadfast spirit within me… Restore to me the joy of your salvation.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Some failures are a slip. David's was a landslide. Adultery, then a cover-up, then a man's death arranged to bury the evidence — sin compounding on sin as one lie required another. This was not a lapse in an otherwise clean record; it was catastrophe, and people died in it.

And yet the Bible's final verdict over David's whole life still reads: "a man after God's own heart." How is that possible? Not because the sin was small — it was enormous. The difference was not the size of the failure but the depth of the repentance. Psalm 51 is what real return sounds like, and it shows us grace's doorway. No excuses. No blame shifted onto Bathsheba or the pressures of kingship. "Against you, you only, have I sinned." David does not manage his failure or spin it. He brings God a broken and contrite heart — and discovers the one sacrifice God has promised never to despise (Psalm 51:17).

Notice what David asks for. Not merely to be let off, but to be remade: "Create in me a pure heart… renew a steadfast spirit… restore to me the joy." He wants the inside repaired, not just the record cleared. And here is the wonder that should undo you — out of the ashes of that very marriage, God brought forth Solomon, and through that same family line, in time, the Messiah Himself.

Grace does not merely clean up after our failures and hurry them out of sight. Grace composts them. It takes the ruined soil of your worst season and grows kingdom fruit in the very same ground. The confession you keep negotiating instead of making is the doorway you keep walking past.

Stop editing the speech. Bring Him the broken heart. He has never once despised it.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Is there a confession you have been negotiating and rehearsing instead of simply making?

— What might God want to grow in the very soil of your worst season, if you let Him have it whole?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, I come like David — no excuses, no spin, just a broken and contrite heart. Create in me a pure heart, renew a steadfast spirit within me, and restore to me the joy of Your salvation. Grow something good in this ruined ground. Amen.

_May the joy of your salvation be restored to you in full measure._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 51; 2 Samuel 12:1–13$dev$),
  (4, 1, 'scripture', 'Today''s Reading', '1 Timothy 1:15–16', $dev$“Here is a trustworthy saying… Christ Jesus came into the world to save sinners — of whom I am the worst. But for that very reason I was shown mercy so that in me… Christ Jesus might display his immense patience as an example.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$Most of us spend enormous energy sanding the rough edges off our past — hoping that if we file it down enough, no one will notice where we've been. Paul did the opposite. He named his worst out loud: he had hunted Christians, approved executions, dragged families apart, and stood guard over the coats of the men who stoned Stephen. He does not minimize it. He calls himself the worst.

But read how he understood his own story, because it is startling: "I was shown mercy so that in me Christ Jesus might display his immense patience as an example." Sit with that. God did not merely forgive Paul's past and file it away. He put it on public display — mounted it in the gallery of grace as Exhibit A of exactly how much patience Christ carries for sinners. The worse the record, the brighter the mercy that had to cover it, and therefore the louder the testimony.

This reframes your history entirely. In the economy of shame, your failure is the thing you hide. In the economy of grace, your forgiven failure is the thing heaven exhibits. It is not evidence against you; it is evidence of Him. Somewhere in your future is a person standing exactly where you once stood — convinced they've gone too far, done too much, that for them the door is shut. And the one thing that could reach them is the news that someone fell precisely where they fell and rose again by grace.

That someone is you. Your testimony is their permission slip. Your scars, honestly shown, become a map that leads a stranger straight to mercy.

So stop editing your story. Start displaying His patience.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— What part of your story have you been hiding that heaven might actually want to display?

— Who in your world might find their hope inside your testimony, if you were willing to tell it?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, make my forgiven past an exhibit of Your patience. I will stop editing my story and start testifying to Your mercy. Take what I was most ashamed of and use it to unlock someone else's hope. Amen.

_May your scars become somebody's map to mercy._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$1 Timothy 1:12–17; Acts 9:1–22$dev$),
  (5, 1, 'scripture', 'Today''s Reading', '1 Samuel 12:20', $dev$“Do not be afraid. You have done all this evil; yet do not turn away from the Lord, but serve the Lord with all your heart.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$There is a lie so quiet and so respectable that most believers never catch it: the lie that pulling away from God after you've failed is a form of humility. It feels reverent. It feels like taking your sin seriously. It is, in fact, the enemy's masterpiece — and today's verse dismantles it in a single word.

Israel had just committed a national failure. They had rejected God's kingship over them and demanded a human king like the nations around them — a stinging betrayal of everything He had been to them. Samuel does not soften it or explain it away: "You have done all this evil." The sin is named plainly. And then comes one of the most beautiful pivots in all of Scripture: "yet."

"Yet do not turn away from the Lord… serve the Lord with all your heart." Feel the direction of that instruction, because it runs against every instinct. Failure tempts us to run from God in shame; grace commands us to run to Him in service. The devil's finest work is convincing a fallen believer that distance from God is a sign of reverence, when it is nothing but defeat wearing a religious mask. Every day you keep your distance in the name of "not being worthy," he counts a victory.

Whatever your "all this evil" is — the thing you're sure has earned you a long probation — heaven has already attached a "yet" to it. And notice: the way back is not years of penance to prove you mean it. It is a turned heart, offered today, with your whole strength poured back into serving Him.

Shame says stay away until you feel clean. Grace says come close, and get to work. The "yet" is God's word over your failure. Don't let shame edit it out.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Has shame been dressing itself up as humility in your life — keeping you at a "respectful" distance from God?

— What would "serving the Lord with all your heart" look like in practice, starting this week?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, I hear the "yet" You have written over my failure. I refuse the false humility of distance that keeps me far from You in the name of reverence. I turn — not away from You, but toward You — and I give You my whole heart's service. Amen.

_May the word "yet" be written by God over every failure in your story._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 12:19–25$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '2 Corinthians 12:9', $dev$“But he said to me, “My grace is sufficient for you, for my power is made perfect in weakness.” Therefore I will boast all the more gladly about my weaknesses, so that Christ’s power may rest on me.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$Three times Paul asked God to take the thorn away. Three times — the same posture we all know: begging heaven to delete the weakness, remove the limp, erase the very thing that keeps us dependent. And most of us assume God's silence means He's ignoring us. But God was not silent. He answered — He simply answered with something better than removal.

"My grace is sufficient for you." Notice the tense: present, permanent, an unbroken supply that does not run dry when the thorn stays. God did not promise to end the weakness. He promised to be enough inside it. And then comes the sentence that turns all human calculation upside down: "My power is made perfect in weakness." Not in spite of your weakness. In it. The strength doesn't arrive after the weakness leaves; it is displayed precisely through the place that stays broken.

Paul understood the picture. "We have this treasure in jars of clay" — the crack in the pot is not a flaw in the plan; it is the place the treasure shines through (2 Corinthians 4:7). The world builds its platforms out of strength and hides every weakness backstage. God does the opposite: He builds His clearest testimonies out of dependence, so that when power shows up, no one can mistake whose it is.

So the weakness you have begged God to edit out of your life may be the very stage He intends to stand on. That thorn you keep negotiating with — what if you stopped long enough to notice the grace quietly growing right beside it?

Stop trying to delete your weakness. Watch His power come and rest on it.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What weakness have you begged God to remove that He may actually intend to inhabit and shine through?

— How would you live differently if you believed dependence were a qualification for His power, not a defect to hide?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Lord, Your grace is sufficient for me — for this thorn, this weakness, this day I would rather have been spared. I stop demanding You delete it. Let Your power rest on the cracked places of my life and shine through them. Amen.

_May Christ's power rest visibly on your weakest place._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$2 Corinthians 12:7–10; 4:7–9$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'John 21:9, 12', $dev$“When they landed, they saw a fire of burning coals there with fish on it, and some bread… Jesus said to them, “Come and have breakfast.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Don't rush past the detail John slips in — the fire was a "fire of burning coals." A charcoal fire. There is only one other charcoal fire in this Gospel, and Peter is standing beside it too, in the high priest's courtyard, warming his hands and swearing three times over that he never knew the man. The smell of charcoal was the smell of Peter's worst night.

So watch what the risen Lord of glory does. He builds another charcoal fire on the shore — and cooks breakfast beside it. Read that until it lands: the King of heaven, days out of the tomb, kneels over coals to make food for the man who publicly disowned Him. There is no tribunal on that beach. There is a table.

And then, three times — once for each denial, healing the wound at its own depth — Jesus asks, "Do you love me?" He does not re-litigate the courtyard. He does not require Peter to explain himself. Each time Peter answers yes, Jesus responds not with a rebuke but with a commission: "Feed my sheep." He did not re-try the case. He re-issued the calling.

This is how Christ handles the ones who have fallen — not with an interrogation, but with an invitation; not "explain yourself" but "come and have breakfast." And look what that restoration unleashed. Fifty days later this same denier stood in Jerusalem and preached, and three thousand people were saved in an afternoon. His restoration was never only about him.

Your restoration isn't only about you either. There are sheep on the far side of it, waiting to be fed. So come to the fire. It's breakfast, not judgment.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— Where do you most need to hear "Come and have breakfast" instead of the "Explain yourself" you keep bracing for?

— What calling do you sense Jesus quietly re-issuing to you right now, on the far side of your failure?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, I come to Your fire — the one with breakfast on it, not judgment. I answer Your question the only honest way I can: You know that I love You. Re-issue my calling, and I will feed Your sheep. Amen.

_May you smell breakfast, not judgment, when you come back to His fire._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$John 21:1–19; Luke 22:31–32$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Philippians 3:13–14', $dev$“But one thing I do: Forgetting what is behind and straining toward what is ahead, I press on toward the goal to win the prize for which God has called me heavenward in Christ Jesus.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Shame is a rehearsal artist. Given a stage, it will replay your failure in high definition — the exact words, the exact faces, the exact moment it all went wrong — night after night, until the past starts to feel more real and more present than any possible future. If you've lain awake watching that reel, you already know its craft.

Now hear Paul, a man with more footage to replay than almost anyone — the arrests he ordered, the blood he approved, the church he tried to destroy. He announces a deliberate policy: "Forgetting what is behind." But be careful what he means. This is not amnesia; Paul could still recite his past in detail when it served the gospel. Biblical forgetting is de-throning. It is refusing to let yesterday sit on the throne and govern today's decisions, today's identity, today's hope.

Think of it as driving. You cannot move forward while staring into the rear-view mirror — and the enemy knows this, which is exactly why he keeps polishing the glass. He can't change your past any more than you can, but he doesn't need to. He only needs to keep you facing it. Every hour you spend curating the museum of your failures is an hour stolen from the "one thing" that is actually ahead of you.

And there is something ahead — a goal, a prize, a heavenward call that God is still working out in your life. Your windscreen is meant to be larger than your mirror. The road God is preparing is out the front glass, not behind your shoulder.

So cut the reel. De-throne the past. Set your eyes forward and press on.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which scene does shame replay most often — and what does it quietly cost you to keep watching it?

— What is the "one thing" ahead of you that deserves the energy the past has been consuming?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Father, I resign as curator of the museum of my failures. I forget what is behind — I de-throne it, I take it off the throne of my today — and I strain toward what You have called me to. Point my eyes forward and hold them there. Amen.

_May your windscreen finally grow larger than your mirror._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Philippians 3:4–14; Isaiah 43:18–19$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Luke 15:20', $dev$“But while he was still a long way off, his father saw him and was filled with compassion for him; he ran to his son, threw his arms around him and kissed him.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$The prodigal wrote a speech on the long road home. You can hear him practicing it with every step — a careful proposal for his own demotion: "I am no longer worthy to be called your son; make me like one of your hired servants." He had done the mathematics of his failure and arrived at a number: reduced worth. Servant, not son. He would take what he could still get.

He never finished the speech. Watch the timing in the verse — "while he was still a long way off, his father saw him." The father had been scanning that horizon, and the moment he spotted the ragged shape of his boy, he was already moving. He ran. Robe, ring, sandals, a feast ordered before a word of the rehearsed apology could be delivered.

And you have to understand what running cost that father. In a Middle Eastern village, a patriarch did not run; it was beneath his dignity, undignified, exposing his bare legs to the mockery of the whole town. This father gathered up his robes and sprinted anyway — deliberately absorbing the village's shame himself so that his returning son would not have to walk that gauntlet of stares alone. He took the humiliation his boy had earned and wore it up the road.

That is your God. While you are still on the road, still rehearsing the version of yourself you think you've been demoted to, He is already in motion toward you. Grace does not wait at the gate with folded arms to see if you're sincere. It does not even meet you halfway.

It outruns you.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What "demotion speech" have you been rehearsing before God — the reduced version of yourself you assume you now deserve?

— Can you let yourself be celebrated — robe and ring and feast — rather than merely tolerated?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, I drop my speech. I receive the robe I did not earn, the ring I do not deserve, and the embrace that outran my repentance. I come home as a child, not an employee. Thank You for running. Amen.

_May you hear running footsteps every time you turn toward home._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 15:11–32$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Jonah 3:1–2', $dev$“Then the word of the Lord came to Jonah a second time: “Go to the great city of Nineveh and proclaim to it the message I give you.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Jonah did not merely stumble in his calling; he ran from it — full speed, opposite direction, onto a ship, into a storm, and finally into the belly of a fish. If ever a prophet had forfeited his commission beyond recovery, surely it was this one, found fast asleep in the cargo hold of his own disobedience while sailors bailed water above his head. His file looked closed with a slam.

Then comes the quietest miracle in the whole book — no fire from heaven, no thunder, just eight words: "The word of the Lord came to Jonah a second time." Read them slowly, because everything hinges on the number. Same commission. Same city — Nineveh, unchanged. Same God, entirely undeterred by the detour, the drowning, and the digestive tract. He did not find a more reliable prophet. He came back to the runaway with the identical assignment.

And when Jonah finally went and finally preached, an entire city turned to God — one of the largest awakenings in all of Scripture. His greatest ministry stood on the far side of his greatest failure, built on ground he had tried to sail away from.

For ten days you have watched grace do what grace does — over Moses and David, Peter and Paul, a prodigal and a runaway prophet. This is the last morning, and it is your commissioning day. The God of second words is speaking again, to you. So steward this new grace well: walk humbly, keep short accounts with Him, and extend to others the very mercy these ten days have poured over you.

The word of the Lord is coming a second time. Get up, and go to your Nineveh.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— What assignment do you sense God re-issuing to you "a second time," on the far side of where you ran?

— Who in your life needs from you the very same mercy these ten days have shown you?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$God of the second word, I hear You. I rise from the ash of my failure, and I go where You send me. Make my whole life a testimony that Your mercies are new every morning — and let me carry that mercy to someone else. Amen.

_May the word of the Lord come to you a second time — and may you run toward it, not away._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Jonah 1–3; Micah 7:8, 18–19$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
