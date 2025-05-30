const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Unique identifier for frontend reference
  title: { type: String, required: true },
  description: { type: String },
  assignee: { type: String, required: true }, // Username of assignee
  status: { 
    type: String, 
    enum: ['not-started', 'in-progress', 'completed'], 
    default: 'not-started' 
  },
  createdBy: { type: String }, // Username of creator
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Schema for scheduled meetings
const ScheduledMeetingSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Unique identifier for the meeting
  title: { type: String, required: true },
  description: { type: String },
  scheduledFor: { type: Date, required: true }, // When the meeting is scheduled to start
  duration: { type: Number, default: 60 }, // Duration in minutes
  createdBy: { type: String, required: true }, // Username of the creator
  createdAt: { type: Date, default: Date.now },
  notified: { type: Boolean, default: false }, // Whether users have been notified
  roomName: { type: String } // Optional room name for the meeting
});

const ProjectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    deadline: { type: String, required: true },
    domain: { type: String, required: true },
    status: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ownerUsername: { type: String, required: true },
    enrolledUsers: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }],
    enrollmentRequests: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        requestDate: { type: Date, default: Date.now }
    }],
    maxTeamSize: { type: Number, default: 4 },    viewCount: { type: Number, default: 0 },
    activities: [{
        type: { type: String, enum: ['status_change', 'enrollment_accepted', 'project_created', 'enrollment_request', 'task_created', 'task_updated', 'task_completed', 'whiteboard_update', 'meeting_scheduled'] },
        timestamp: { type: Date, default: Date.now },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        username: { type: String },
        details: { type: String },
        oldValue: { type: String },
        newValue: { type: String }
    }],
    // Dashboard specific fields
    tasks: [TaskSchema],
    contributions: [{
        username: { type: String, required: true },
        taskCount: { type: Number, default: 0 },
        color: { type: String, default: '#3498db' } // Store user's chart color
    }],
    // Meeting status    meetingActive: { type: Boolean, default: false },
    meetingCreator: { type: String }, // Username of the meeting creator
    meetingStartTime: { type: Date },
    meetingRoom: { type: String }, // Jitsi meeting room ID
    // Scheduled meetings
    scheduledMeetings: [ScheduledMeetingSchema],
    // Notifications for meetings
    notifications: [{
        type: { type: String, enum: ['meeting_scheduled', 'meeting_reminder'] },
        meetingId: { type: String },
        message: { type: String },
        timestamp: { type: Date, default: Date.now },
        read: { type: Boolean, default: false }
    }],
    // Whiteboard data
    whiteboardData: { 
        type: mongoose.Schema.Types.Mixed, // Store Excalidraw scene data as a mixed type
        default: null
    },
    // Additional features
    resources: [{
        title: { type: String },
        url: { type: String },
        type: { type: String }, // document, link, etc.
        uploadedBy: { type: String },
        uploadedAt: { type: Date, default: Date.now }
    }],
    // Message/chat system
    messages: [{
        sender: { type: String, required: true }, // Username of sender
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }]
});

const Project = mongoose.model('Project', ProjectSchema);

module.exports = Project;