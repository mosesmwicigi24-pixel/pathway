-- Reseed healed-of-rejection with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'healed-of-rejection');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Isaiah 53:3', 'The Rejected Christ Understands You'),
  (2, 'Psalm 147:3', 'Naming the Wound'),
  (3, 'Jeremiah 1:5', 'Known Before the Womb'),
  (4, 'Psalm 27:10', 'Though Father and Mother Forsake Me'),
  (5, 'Romans 12:2', 'The Lies the Wound Taught You'),
  (6, 'Ephesians 4:31–32', 'Hurting People Hurt People — Healed People Heal Them'),
  (7, 'Isaiah 49:15–16', 'Engraved on His Palms'),
  (8, 'Galatians 3:13–14', 'Redeemed From Every Curse'),
  (9, 'Psalm 34:5', 'Favor on Your Face'),
  (10, 'Ephesians 1:4, 6', 'Chosen — and Choosing to Bless')
) AS v(n, ref, title) WHERE p.code = 'healed-of-rejection';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'healed-of-rejection'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Isaiah 53:3', $dev$“He was despised and rejected by mankind, a man of suffering, and familiar with pain… he was despised, and we held him in low esteem.”$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$Before we lay a single finger on your wound, meet the One who already wears the same scar. We assume Jesus arrives to our pain as a doctor arrives to a patient — competent, but from the outside. Isaiah says otherwise.

Look at how the prophet describes Him seven hundred years before He was born: despised, rejected, a man of suffering, familiar with pain. That last word is intimate. He was not merely acquainted with rejection the way you are acquainted with a distant relative; He was familiar with it, like a face He saw in the mirror every day. And His life proved it. He was misunderstood by His own family, betrayed by a friend with a kiss, denied by the disciple He loved, traded by the crowd for a convicted criminal, and in the darkest hour history has ever known He cried out, “My God, my God, why have you forsaken me?” (Matthew 27:46). There is no basement of rejection you have visited that He did not descend past on His way to somewhere lower.

This changes how you pray. When you tell God you feel unwanted, you are not translating your experience into a foreign language He must learn. You are speaking His mother tongue. He does not nod politely at your grief from a throne of comfort; He recognizes it. And then watch what heaven does with the Rejected One: “the stone the builders rejected has become the cornerstone” (Psalm 118:22). The very stone that was thrown on the reject pile became the load-bearing centre of everything God was building.

That is not just His story. It is the blueprint of your healing. So today, bring your rejection to the only Man qualified to hold it — not a spectator, but a survivor. In the hands of God, rejected stones do not stay on the reject pile. They become cornerstones.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— What actually changes for you knowing that Christ understands rejection from the inside, not just from the outside?

— Where in your life might God be quietly turning a rejected stone into a cornerstone?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, Man of Sorrows, You know this wound by its first name. I bring my rejection to the only One who was rejected more deeply than I ever will be — and who loved more perfectly than I ever could. Do not heal me at a distance; heal me from the inside, the way You entered it. Begin Your work in me today. Amen.

_May you feel deeply understood today — by the God who has felt what you feel._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 53:1–5; Psalm 118:22–23; Matthew 27:46$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Psalm 147:3', $dev$“He heals the brokenhearted and binds up their wounds.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$A wound that is never named is a wound that never heals. It just gets buried alive and keeps working underground. So before we go any further, let us drag this one into the light and say it out loud.

Rejection is the sense of being cast aside — unwanted, unwelcomed, devalued, treated as though you were disposable. At its root it is the absence of love, and this is why it wounds so deeply: you were created by a loving God to love and to be loved, so the absence of love strikes you at the exact place you were built to be filled. That is not fragility; that is design. Notice, too, that today's verse joins two things — a broken heart and a wound — as if to insist that what happened inside you was not imaginary. Heaven files your heartbreak under injury, not weakness.

Yours may have entered through a divorce or a broken engagement. Through being compared, always unfavourably, to a sibling. Through abuse that taught your body to expect harm. Through a long run of failures that whispered you were the problem. Through words spoken carelessly that lodged in you like arrows and are still there. However it came in, it was real — and God never once asks you to pretend it wasn't. He does not require you to minimise your injury before He will attend to it.

Look again at what the verse actually promises: He heals, and He binds up. Binding up is what you do for a wound you take seriously — you clean it, you cover it, you protect it while it knits back together. That is heaven's posture toward you right now. You are not weak for hurting. You are human, you are injured, and you are already on the Healer's schedule. Naming it today is not the failure. Naming it is the first stitch.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— If you traced your sense of being unwanted back to its very first door, where did it enter?

— Have you let yourself call it a wound — or have you been quietly filing it under weakness?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, I stop pretending. Here is the wound — I name it before You out loud, without minimising it or excusing the ones who caused it. Thank You that You do not despise a broken heart; You bind it up. I climb onto the Healer's schedule today and place myself under Your bandage. Amen.

_May naming the wound today be the beginning of losing it forever._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 147:3; Psalm 34:18$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Jeremiah 1:5', $dev$“Before I formed you in the womb I knew you, before you were born I set you apart.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Some people carry a strange, wordless ache their whole lives — a low hum that says, quietly, I am an intrusion here. A guest nobody invited. If that describes you, know first that it often begins before memory does.

A child conceived unplanned, a pregnancy the parents dreaded, a baby who arrived as the “wrong” gender or at the “wrong” time — such a child can absorb a sense of being an interruption in the world, an accident that everyone politely tolerates. And the wound is real. But today's verse walks straight into that nursery and performs surgery. God says to Jeremiah — and through him, to you — before I formed you in the womb, I knew you. Not knew about you. Knew you. Personally. Before your mother suspected you existed, your Maker had already met you.

Here is the truth that heals: human planning and divine purpose are two entirely different registries, and you can be missing from the first while being written boldly into the second. Your parents may not have planned you. God did. “Your eyes saw my unformed body; all the days ordained for me were written in your book before one of them came to be” (Psalm 139:16). While a nurse was still counting weeks, the Author was already counting your days. You were not merely permitted into the world; you were set apart and sent into it. There is an ocean of difference between happening and being sent.

So today, renounce the old sentence and receive the true one. You are not an oversight the universe is tolerating. You were commissioned before you were conceived. Healing begins the moment that difference stops being a nice idea and becomes the thing you believe.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you carried a quiet sense of being an intrusion — a guest nobody actually invited?

— What genuinely changes when you swap “I happened” for “I was sent”?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, before the womb, You knew me — and You still do. I renounce the lie that I am an accident, an intrusion, an inconvenience the world is tolerating. I refuse the registry of human planning and I accept the registry of heaven: I was known, set apart, and sent. Amen.

_May the sent-ness of your life silence every whisper that you were unwanted._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Jeremiah 1:4–8; Psalm 139:13–18$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Psalm 27:10', $dev$“Though my father and mother forsake me, the Lord will receive me.”$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$The deepest rejections almost always wear a family face. Not a stranger's — a familiar one. The father who was there but never present. The mother whose approval always hovered just out of reach. The home where you learned to read the temperature of a room before you learned to read a book.

Family wounds cut deeper than others, and there is a reason. Parents were designed by God to be your very first picture of Him — the first hands to hold you, the first love to teach you what love is. So when those hands drop you, the injury doesn't stay in the family album; it quietly rewrites your image of God. David knew this, and his verse refuses to look away from the worst case. He does not say if. He says though — though my father and mother forsake me. He names the unthinkable and then answers it: even if the two people ordained to want you did not, the Lord will receive me.

Sit with that word receive. In Hebrew it carries the sense of gathering up — the way someone lifts an abandoned child from the roadside, brushes off the dust, and carries it home to belong. That is what God does with the forsaken. He does not merely permit you to approach; He comes and gathers you up. Which means the last word over your identity was never spoken by the ones who left. It is spoken by the One who received you.

So today, hand Him the exact place the wound is — the specific memory, the specific parent, the specific ache. Let Him gather you up precisely where you were let down. And hold this truth like a shield: another person's rejection is only ever information about their capacity to love. It is never, ever a verdict on your worth.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— Has a family wound been quietly shaping your picture of God? In what specific way?

— What would it mean to let the Lord “gather you up” in the very place a parent let you down?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, where my first pictures of love came out broken, paint Yours over them. I bring You the family wounds I have carried so quietly for so long that I stopped noticing their weight. Receive me. Gather me up from the roadside. Re-parent my heart. Amen.

_May the Father's receiving heal every place a parent's forsaking has touched._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 27:7–14; Isaiah 49:15–16$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Romans 12:2', $dev$“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$Rejection is not a silent wound. It is a teacher — and every day it stands at the front of the classroom teaching lies with total confidence.

Its favourite lesson is over-generalisation. Rejected by one man, a woman quietly concludes “all men are the same.” Betrayed by one friend, a man begins to flinch at every hand extended toward him since. One person's failure hardens into a doctrine about the entire human race, and here is the tragedy of it: innocent people spend years paying a bill they never ran up. The next friend inherits the last friend's crime. The wound teaches a second lesson too, quieter but just as costly — it tells you to grow a shell. Become harder. Feel less. And it works, in a way: the armour does keep new pain out. But armour does not filter. The same shell that blocks the hurt blocks the love, and you end up defended and starving at the same time.

This is exactly why Paul does not say try harder or feel better. He says be transformed by the renewing of your mind. Healing is not you gritting your teeth against the lies; it is Christ re-teaching the mind the wound has trained. And He starts by naming the lies out loud so they lose their disguise. Not all people are your past. The next person is not the last person. Your future has committed no crime, so it does not deserve your history's sentence.

So today, retire one lie. Just one. Drag one “all people are…” conclusion into the light, look at it honestly, and let Christ replace it with the truth. And ask Him for the harder gift — to soften the shell without leaving you exposed, so that He becomes your protection and your heart is finally free to stay open.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— What “all people are…” doctrine did your wound quietly write — and who is paying its bill today?

— Where has your protective shell been keeping love out along with the hurt?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Lord, expose the lies my wound taught me and retire them one by one until the classroom is empty. Soften the shell without leaving me unguarded — You be my protection, so that my heart can finally stay open. Renew my mind where the wound trained it. Amen.

_May your heart un-learn the lies and stay soft — guarded by God, not by walls._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 12:2; Ezekiel 36:26$dev$),
  (6, 1, 'scripture', 'Today''s Reading', 'Ephesians 4:31–32', $dev$“Get rid of all bitterness, rage and anger… Be kind and compassionate to one another, forgiving each other, just as in Christ God forgave you.”$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$There is a sobering law that governs the world of wounds, and once you see it you will see it everywhere: hurting people hurt people. Rejected people reject others. The pain we refuse to transform, we transmit.

It travels down the closest relationships first — to a spouse who wasn't there when the wound was made, to children who inherit a bitterness they never earned, to whoever happens to be standing nearby the moment the old injury gets touched. This is how wounds outlive the people who caused them, passing quietly from one generation to the next like a family heirloom nobody wanted. But — and this is today's good news, so lean in — the law runs in the other direction just as reliably: healed people heal people. A restored heart carries medicine into every room it walks into. The same closeness that spread the pain can spread the cure.

The hinge between transmitting and healing is one decision, and it has a name most of us have misunderstood. Forgiveness. Hear this clearly, because the confusion here keeps thousands of people bound: forgiveness is not an emotion, it is a decision. You will not feel your way into it; you will choose your way into it, and often the feelings arrive much later, if at all. And forgiveness is not saying the rejection didn't matter — it mattered enormously; that is the whole point. Forgiveness is simply refusing to keep drinking poison in the hope that the person who hurt you will be the one to suffer.

So release them today. Not because they have earned it — they may never earn it. Release them because you deserve to be free, and because you cannot become a healer while your hands are still clenched around a grudge. Take your heart back, and let it become medicine.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— Who has been receiving the pain you have not yet transformed?

— Whom do you need to release today by decision — even before your feelings agree to it?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$Father, I choose — by decision, not by emotion — to forgive those who rejected me. I stop drinking the poison. I release them into Your hands, and I take my own heart back out of theirs. Break the cycle here, with me, and make me a healer of the very wound I once carried. Amen.

_May the cycle break with you — and may your hands become healing hands._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 4:29–32; Matthew 18:21–35$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'Isaiah 49:15–16', $dev$“Can a mother forget the baby at her breast and have no compassion on the child she has borne? Though she may forget, I will not forget you! See, I have engraved you on the palms of my hands.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$When God wants to prove that He will never forget you, He does something remarkable: He reaches for the strongest bond He can find in all of human experience — a nursing mother and the baby at her breast — and then quietly says that even this is weaker than His love for you.

Think about what He is claiming. A mother's attachment to her infant is nearly the most unbreakable thing on earth; her body itself remembers the child. And yet God allows for the unthinkable — though she may forget — because human love, even at its absolute best, is finite and can fail. Then He draws the line: I will not forget you. Divine love has no ceiling to fall from. But He is not finished. The image sharpens into something almost startling: See, I have engraved you on the palms of my hands. Not written — ink fades, notes get erased, names slip off lists. Engraved. Cut in. Carved so deep it becomes part of the surface forever.

And here the prophecy reaches across the centuries and becomes literal. There are nail marks in the palms of Jesus Christ. When Thomas doubted, the risen Lord held out His scarred hands and said, “Put your finger here; see my hands” (John 20:27). Your remembrance is not a sentiment God feels; it is a scar God carries. Every time the enemy whispers that you have been forgotten — overlooked at work, uninvited again, unseen in your own home — heaven answers by holding up two wounded hands.

You are not an entry in God's diary that might get lost between the pages. You are an engraving in His flesh. So the next time you feel forgotten, do not argue with the feeling. Just look at His hands.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— What situation right now has made you feel quietly forgotten by God?

— What does it do to your heart that your remembrance cost Christ His hands?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, when I feel forgotten, turn my eyes to Your hands. I am engraved, not merely jotted down; carved into Your palms, not penciled into Your margins where I might be erased. When the whisper of “forgotten” comes, let me answer it with Your scars. I rest today in a love that cannot forget me. Amen.

_May you see your name in His palms every time the world overlooks you._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$Isaiah 49:13–16; John 20:24–29$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Galatians 3:13–14', $dev$“Christ redeemed us from the curse of the law by becoming a curse for us… He redeemed us in order that the blessing given to Abraham might come to the Gentiles through Christ Jesus.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$Some rejection is not only a memory; it behaves like a shadow that follows a whole life. You know the pattern if you live it — being overlooked again and again, doors that close for no reason anyone can explain, an old script of exclusion that keeps repeating no matter which room you walk into. It can begin to feel less like a series of events and more like a weather system over you.

Whatever its source, hear the gospel's verdict on it, because it is stronger than any pattern: Christ has already dealt with every curse at the root. Paul says He was made a curse for us. On the cross, Jesus took the whole weight of rejection onto Himself — hung on a tree, cast out by the earth He made, and for one unbearable hour turned away from by heaven itself — so that the blessing promised to Abraham could flow freely down to you. Look at the exchange, because it is total and it is finished: His rejection purchased your acceptance. His exclusion purchased your welcome. His being cast out purchased your being brought in.

This means the healing you need here is not primarily something to break — it is something to stand in. You do not have to shatter a curse that Christ already shattered two thousand years ago; you have to plant your feet in His finished work and refuse to move. The shadow has no legal claim on a redeemed life. It may still make noise. It has no authority.

So today, stop striving against what has already been settled and simply take your stand. Walk out from under the old weather. The verdict over your life is not exclusion; it is blessing — bought, sealed, and handed to you at the cross.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Have you noticed repeating patterns of exclusion that feel bigger than mere circumstance?

— What would change if you stopped fighting a curse and simply stood in an exchange that is already finished?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You were made a curse so that I could be made blessed. I stop striving against what You have already settled, and I take my stand in the exchange: every shadow of rejection over my life is cancelled at Your cross and has no legal claim on me. I receive the blessing of Abraham as my inheritance. Amen.

_May the blessing purchased for you settle visibly on your life this week._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Galatians 3:10–14; Deuteronomy 28:1–14$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Psalm 34:5', $dev$“Those who look to him are radiant; their faces are never covered with shame.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Here is a secret about rejection that almost nobody tells you: it shows. It does not stay hidden inside; it leaks out onto the surface of your life where everyone can read it.

Walk into a job interview carrying an old rejection and it sits in your shoulders, dims your eyes, thins your voice — and the room, without knowing why, responds to what you are carrying. Wounded expectation has a strange power: it tends to manufacture the very rejection it dreads. The person braced to be turned away often signals that so clearly that they are. This is not superstition; it is simply what a hurting countenance broadcasts before a single word is spoken. And it is exactly why healing is not a luxury but a necessity — because until the wound heals, it keeps announcing itself, and it keeps recruiting the outcome it fears.

But look at the beauty treatment heaven prescribes: those who look to Him are radiant. Not those who work on their confidence, or rehearse their affirmations in the mirror — those who look to Him. Radiance here is not cosmetic; it is a reflection. It is the glow that settles on a face that has spent time gazing at unconditional love. You cannot behold the God who accepts you completely and keep the expression of one who expects to be rejected. Shame simply cannot survive on a face that is fixed on Him.

So make looking to Him your daily beauty routine, and then expect the practical harvest. As healing settles into your countenance, rooms will begin to respond to you differently — not because you have learned a technique, but because you now enter them as a different person. Favour is drawn to a healed face. Look to Him until it shows.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What have your face and your posture been announcing about you before you even speak?

— How could “looking to Him” become your actual daily beauty routine this week?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, heal my countenance. Let the old rejection drain out of my eyes and let Your radiance take its place. I will not manufacture confidence in a mirror; I will look to You until Your acceptance shows on my face and favour follows me into every room. Amen.

_May people meet the favour on your face before they ever learn your name._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 34:1–8; Numbers 6:24–26$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Ephesians 1:4, 6', $dev$“For he chose us in him before the creation of the world… to the praise of his glorious grace, which he has freely given us in the One he loves.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$Ten days ago you opened this plan as the unwanted one. Before you close it, hear the verdict heaven has been speaking over you the whole time — and let it be the last word, because it always was.

You were chosen in Him before the creation of the world. Adopted in love. Accepted in the Beloved. Read that timeline slowly: before there was light, before there was earth, before there was time itself to hold your rejection — there was your election. Rejection came late. It was never the first word over your life, and it will not be the last. The first and final word is chosen. But a healed heart is never merely a healed heart; it is a commissioned one. God does not restore you only so you can feel better. He restores you so you can become a giver of the very thing you were once denied.

So become a chooser of others. If you have children, this is your sacred assignment: speak blessing over them and refuse to compare them, because each one is unrepeatable. Build warm memories on purpose — pray with them, play with them, be genuinely present, because they will always need your presence more than your presents. Dedicate them to God and prophesy good over their futures out loud. And if there are no children in your home, do the same for every soul in your reach: welcome the unwelcomed, notice the overlooked, choose the ones the world keeps passing by.

Do you see what God has done? The wound you carried for years has become a well that others can drink from. Nothing about your pain was wasted; all of it was redeemed. So never again introduce yourself as the rejected one. You are the chosen of God — now go and choose someone.$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Who in your world is right now waiting to be chosen the way you have been chosen?

— What specific blessing will you speak over your children — or your circle — this very week?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Father, I stand accepted in the Beloved — chosen before the world began, and never an afterthought. Do not stop at healing me; commission me. Make me a chooser: my home a place of welcome, my words a fountain of blessing, my once-wounded heart a well the thirsty can drink from. Amen.

_May you never again introduce yourself as the rejected one — you are the chosen of God._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Ephesians 1:3–14; 1 Peter 2:9–10$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
