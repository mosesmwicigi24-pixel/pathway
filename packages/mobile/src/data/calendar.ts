// Presentational sample calendar content, mirroring the Figma Make design. Events
// carry an id so the Event detail screen can resolve one by route param. Replaced
// by the calendar module's API reads once wired (events are server-owned, §3).

export type EventType = "service" | "class" | "deadline" | "mentor" | "prayer";

export interface CalendarEvent {
  id: string;
  day: number;
  title: string;
  time: string;
  location: string;
  type: EventType;
  urgent?: boolean;
  description: string;
  photos: string[];
  videos: string[];
}

export const CALENDAR_EVENTS: CalendarEvent[] = [
  { id: "sunday-worship", day: 6, title: "Sunday Worship Service", time: "9:00 AM", location: "Main Sanctuary", type: "service", urgent: true, description: "A gathered worship service with praise, teaching, prayer, and ministry updates for the whole church family.", photos: ["Sanctuary", "Choir"], videos: ["Service preview", "Worship rehearsal"] },
  { id: "new-believers", day: 6, title: "New Believers Class", time: "12:30 PM", location: "Room 204", type: "class", description: "A simple orientation for new believers covering salvation, water baptism, prayer, and next steps in Nuru Pathway.", photos: ["Classroom", "Welcome desk"], videos: ["Class intro"] },
  { id: "l2-quiz-deadline", day: 8, title: "Level 2 Quiz Deadline", time: "6:00 PM", location: "Nuru Pathway", type: "deadline", urgent: true, description: "Complete your Level 2 quiz before the evening deadline. Downloaded lessons remain available offline for final review.", photos: ["Study guide", "Progress card"], videos: ["Quiz tips", "Mentor encouragement"] },
  { id: "mentor-checkin", day: 10, title: "Mentor Check-in", time: "7:30 PM", location: "Video call", type: "mentor", description: "A short pastoral check-in with your assigned mentor to review your lesson notes, questions, and prayer requests.", photos: ["Mentor room"], videos: ["How to prepare"] },
  { id: "prayer-fasting", day: 12, title: "Prayer & Fasting", time: "6:00 AM", location: "Campus chapel", type: "prayer", description: "A morning prayer gathering focused on spiritual growth, consecration, and intercession for families and nations.", photos: ["Chapel", "Prayer circle"], videos: ["Prayer focus"] },
  { id: "cohort-discussion", day: 15, title: "Cohort Discussion", time: "5:30 PM", location: "Hall B", type: "class", description: "A small group discussion for Level 2 learners with reflection questions, testimonies, and guided application.", photos: ["Hall B", "Group tables"], videos: ["Discussion guide"] },
  { id: "outreach-briefing", day: 21, title: "Outreach Briefing", time: "4:00 PM", location: "Community Center", type: "service", description: "Preparation meeting for the outreach team with logistics, prayer points, and team assignments.", photos: ["Outreach team", "Community center"], videos: ["Safety briefing"] },
  { id: "certificate-review", day: 26, title: "Certificate Review", time: "10:00 AM", location: "Admin desk", type: "deadline", description: "Administrative review for completed lessons, quizzes, attendance records, and certificate eligibility.", photos: ["Admin desk", "Certificate sample"], videos: ["Certificate process"] },
];

export function findEvent(id: string): CalendarEvent | undefined {
  return CALENDAR_EVENTS.find((e) => e.id === id);
}
