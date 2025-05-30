const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Use env variable with fallback

// Middleware to authenticate user
const authenticate = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ message: 'Access denied' });

    try {
        console.log('Authenticating with token:', token.substring(0, 15) + '...');
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('Token decoded successfully, user ID:', decoded.userId);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Authentication error:', error.message);
        res.status(400).json({ message: 'Invalid token', error: error.message });
    }
};

// Get all projects (No authentication required)
router.get('/', async (req, res) => {
    try {
        const projects = await Project.find();
        res.json(projects);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching projects', error });
    }
});

// Get a specific project (No authentication required)
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const project = await Project.findById(id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        res.json(project);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching project', error });
    }
});

// Create a new project
router.post('/', authenticate, async (req, res) => {
    const { title, description, deadline, domain, status } = req.body;

    try {
        // Get username for activity log
        const user = await User.findById(req.user.userId);
        const username = user ? user.username : 'Unknown User';

        const newProject = new Project({ 
            title, 
            description, 
            deadline, 
            domain, 
            status, 
            userId: req.user.userId,
            ownerUsername: username,
            activities: [{
                type: 'project_created',
                userId: req.user.userId,
                username: username,
                details: 'Project was created',
                timestamp: new Date()
            }]
        });
        
        await newProject.save();
        res.status(201).json(newProject);
    } catch (error) {
        res.status(400).json({ message: 'Enter Valid details', error });
    }
});

// Update project status
router.patch('/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        const project = await Project.findOne({ _id: id, userId: req.user.userId });
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found or you do not have permission to update this project' });
        }
        
        // Get username for activity log
        const user = await User.findById(req.user.userId);
        const username = user ? user.username : 'Unknown User';
        
        // Add activity for status change
        project.activities.push({
            type: 'status_change',
            userId: req.user.userId,
            username: username,
            details: 'Project status was updated',
            oldValue: project.status,
            newValue: status,
            timestamp: new Date()
        });
        
        // Update status
        project.status = status;
        await project.save();
        
        res.json(project);
    } catch (error) {
        res.status(500).json({ message: 'Error updating project status', error });
    }
});

// Delete a project
router.delete('/:id', authenticate, async (req, res) => {
    const { id } = req.params;

    try {
        const project = await Project.findOneAndDelete({ _id: id, userId: req.user.userId });
        if (!project) {
            return res.status(404).json({ message: 'Project not found or you do not have permission to delete this project' });
        }
        res.status(200).json({ message: 'Project deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting project', error });
    }
});

// Enroll in a project (now creates a request)
router.post('/:id/enroll', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        // Find the project
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if project is closed
        if (project.status === 'Closed') {
            return res.status(400).json({ message: 'Cannot enroll in a closed project' });
        }

        // Check if user is the owner
        if (project.userId.toString() === userId) {
            return res.status(400).json({ message: 'You cannot enroll in your own project' });
        }

        // Check if user is already enrolled
        if (project.enrolledUsers.includes(userId)) {
            return res.status(400).json({ message: 'You are already enrolled in this project' });
        }

        // Check if user already has a pending request
        const existingRequest = project.enrollmentRequests.find(
            request => request.userId.toString() === userId
        );
        
        if (existingRequest) {
            return res.status(400).json({ message: 'You already have a pending enrollment request' });
        }

        // Check if team is full
        if (project.enrolledUsers.length >= project.maxTeamSize) {
            return res.status(400).json({ message: 'Team is full' });
        }

        // Get username for activity log
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Add enrollment request
        project.enrollmentRequests.push({ userId });
        
        // Add activity for enrollment request
        project.activities.push({
            type: 'enrollment_request',
            userId: userId,
            username: username,
            details: 'Requested to join the project',
            timestamp: new Date()
        });
        
        await project.save();

        res.status(200).json({ 
            message: 'Enrollment request sent successfully',
            requestId: project.enrollmentRequests[project.enrollmentRequests.length - 1]._id
        });
    } catch (error) {
        res.status(500).json({ message: 'Error sending enrollment request', error });
    }
});

// Get enrollment requests for a project (owner only)
router.get('/:id/requests', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user is the owner
        if (project.userId.toString() !== userId) {
            return res.status(403).json({ message: 'Only the project owner can view enrollment requests' });
        }

        // Populate user details for each request
        const populatedProject = await Project.findById(id).populate({
            path: 'enrollmentRequests.userId',
            select: 'username'
        });

        const requests = populatedProject.enrollmentRequests.map(request => ({
            requestId: request._id,
            userId: request.userId._id,
            username: request.userId.username,
            requestDate: request.requestDate
        }));

        res.status(200).json(requests);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching enrollment requests', error });
    }
});

// Approve or reject an enrollment request
router.patch('/:id/requests/:requestId', authenticate, async (req, res) => {
    const { id, requestId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user is the owner
        if (project.userId.toString() !== userId) {
            return res.status(403).json({ message: 'Only the project owner can approve or reject requests' });
        }

        // Find the request
        const requestIndex = project.enrollmentRequests.findIndex(
            request => request._id.toString() === requestId
        );

        if (requestIndex === -1) {
            return res.status(404).json({ message: 'Enrollment request not found' });
        }

        const request = project.enrollmentRequests[requestIndex];
        
        // Get username of the requester for activity log
        const requester = await User.findById(request.userId);
        const requesterUsername = requester ? requester.username : 'Unknown User';
        
        // Get username of the owner for activity log
        const owner = await User.findById(userId);
        const ownerUsername = owner ? owner.username : 'Unknown User';

        if (action === 'approve') {
            // Check if team is full
            if (project.enrolledUsers.length >= project.maxTeamSize) {
                return res.status(400).json({ message: 'Team is full' });
            }

            // Add user to enrolled users
            project.enrolledUsers.push(request.userId);
            
            // Add activity for enrollment acceptance
            project.activities.push({
                type: 'enrollment_accepted',
                userId: userId, // Owner who accepted
                username: ownerUsername,
                details: `Accepted enrollment request from ${requesterUsername}`,
                timestamp: new Date()
            });
        }

        // Remove the request
        project.enrollmentRequests.splice(requestIndex, 1);
        await project.save();

        res.status(200).json({ 
            message: action === 'approve' ? 'Enrollment request approved' : 'Enrollment request rejected',
            enrolledUsers: project.enrolledUsers,
            isFull: project.enrolledUsers.length >= project.maxTeamSize
        });
    } catch (error) {
        res.status(500).json({ message: 'Error processing enrollment request', error });
    }
});

// Get enrollment status for a project
router.get('/:id/enrollment', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const isEnrolled = project.enrolledUsers.some(id => id.toString() === userId);
        const isOwner = project.userId.toString() === userId;
        const isFull = project.enrolledUsers.length >= project.maxTeamSize;
        const hasPendingRequest = project.enrollmentRequests.some(
            request => request.userId.toString() === userId
        );
        const requestCount = isOwner ? project.enrollmentRequests.length : 0;

        res.status(200).json({
            isEnrolled,
            isOwner,
            isFull,
            hasPendingRequest,
            requestCount,
            enrolledCount: project.enrolledUsers.length,
            maxTeamSize: project.maxTeamSize
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching enrollment status', error });
    }
});

// Get user's username by ID
router.get('/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ username: user.username });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user', error });
    }
});

// Get user's ID by username
router.get('/user/byUsername/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ userId: user._id });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user ID', error });
    }
});

// Get recommended projects based on domain (excluding current project and user's own projects)
router.get('/:id/recommended', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        // Get the current project to find its domain
        const currentProject = await Project.findById(id);
        
        if (!currentProject) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Find projects with the same domain, excluding the current project and user's own projects
        const recommendedProjects = await Project.find({
            _id: { $ne: id },
            userId: { $ne: userId },
            domain: currentProject.domain,
            status: { $ne: 'Closed' } // Optionally exclude closed projects
        }).limit(5); // Limit to 5 recommended projects

        res.json(recommendedProjects);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching recommended projects', error });
    }
});

// Get project activities
router.get('/:id/activities', async (req, res) => {
    const { id } = req.params;
    
    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        
        // Sort activities by timestamp (newest first)
        const activities = project.activities.sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        res.json(activities);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching project activities', error });
    }
});

// Increment project view count
router.post('/:id/view', async (req, res) => {
    const { id } = req.params;
    
    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        
        // Initialize viewCount if it doesn't exist
        if (!project.viewCount) {
            project.viewCount = 0;
        }
        
        // Increment view count
        project.viewCount += 1;
        
        await project.save();
        
        res.status(200).json({ 
            message: 'View count incremented successfully',
            viewCount: project.viewCount
        });
    } catch (error) {
        res.status(500).json({ message: 'Error incrementing view count', error });
    }
});

// Dashboard API - Get project dashboard data
router.get('/:id/dashboard', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have access to this project dashboard' });
        }

        // Get owner username
        const owner = await User.findById(project.userId);
        const ownerUsername = owner ? owner.username : 'Unknown';

        // Prepare dashboard data
        const dashboardData = {
            projectId: project._id,
            title: project.title,
            description: project.description,
            status: project.status,
            deadline: project.deadline,
            domain: project.domain,
            ownerUsername,
            tasks: project.tasks || [],
            contributions: project.contributions || [],
            resources: project.resources || [],
            messages: project.messages || []
        };

        res.status(200).json(dashboardData);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching dashboard data', error });
    }
});

// Check if user has access to a project dashboard
router.get('/:id/access', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        res.status(200).json({ hasAccess: isOwner || isEnrolled });
    } catch (error) {
        res.status(500).json({ message: 'Error checking project access', error });
    }
});

// Task API - Create a new task
router.post('/:id/tasks', authenticate, async (req, res) => {
    const { id } = req.params;
    const { title, description, assignee } = req.body;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to add tasks to this project' });
        }

        // Get username for activity log
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Create new task
        const taskId = `task-${Date.now()}`;
        const newTask = {
            id: taskId,
            title,
            description,
            assignee,
            status: 'not-started',
            createdBy: username,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Update project with new task
        project.tasks = project.tasks || [];
        project.tasks.push(newTask);

        // Add activity for task creation
        project.activities.push({
            type: 'task_created',
            userId,
            username,
            details: `Created task: ${title}`,
            timestamp: new Date()
        });

        await project.save();

        res.status(201).json(newTask);
    } catch (error) {
        res.status(500).json({ message: 'Error creating task', error });
    }
});

// Task API - Update task status
router.patch('/:id/tasks/:taskId', authenticate, async (req, res) => {
    const { id, taskId } = req.params;
    const { status, title, description, assignee } = req.body;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to update tasks in this project' });
        }

        // Get username for activity log
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Find the task
        const taskIndex = project.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ message: 'Task not found' });
        }

        const task = project.tasks[taskIndex];
        const oldStatus = task.status;
        
        // Update task
        if (title !== undefined) task.title = title;
        if (description !== undefined) task.description = description;
        if (assignee !== undefined) task.assignee = assignee;
        if (status !== undefined) task.status = status;
        task.updatedAt = new Date();

        // Update contribution data if task is moved to completed
        if (status === 'completed' && oldStatus !== 'completed') {
            // Find or create contribution entry for assignee
            let contributionIndex = project.contributions.findIndex(
                contrib => contrib.username === task.assignee
            );
            
            if (contributionIndex === -1) {
                // Create new contribution entry with a unique color
                project.contributions.push({
                    username: task.assignee,
                    taskCount: 1,
                    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 65%)`
                });
            } else {
                // Increment existing contribution
                project.contributions[contributionIndex].taskCount += 1;
            }

            // Add activity for task completion
            project.activities.push({
                type: 'task_completed',
                userId,
                username,
                details: `Completed task: ${task.title}`,
                timestamp: new Date()
            });
        } 
        // Decrease contribution count if task is moved from completed to another status
        else if (status !== 'completed' && oldStatus === 'completed') {
            const contributionIndex = project.contributions.findIndex(
                contrib => contrib.username === task.assignee
            );
            
            if (contributionIndex !== -1) {
                project.contributions[contributionIndex].taskCount = 
                    Math.max(0, project.contributions[contributionIndex].taskCount - 1);
            }
        }

        // Add activity for task update
        if (status !== oldStatus) {
            project.activities.push({
                type: 'task_updated',
                userId,
                username,
                details: `Updated task status: ${task.title}`,
                oldValue: oldStatus,
                newValue: status,
                timestamp: new Date()
            });
        }

        await project.save();

        res.status(200).json(task);
    } catch (error) {
        res.status(500).json({ message: 'Error updating task', error });
    }
});

// Task API - Delete task
router.delete('/:id/tasks/:taskId', authenticate, async (req, res) => {
    const { id, taskId } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to delete tasks in this project' });
        }

        // Find the task
        const taskIndex = project.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ message: 'Task not found' });
        }

        const task = project.tasks[taskIndex];

        // If task was completed, update contribution count
        if (task.status === 'completed') {
            const contributionIndex = project.contributions.findIndex(
                contrib => contrib.username === task.assignee
            );
            
            if (contributionIndex !== -1) {
                project.contributions[contributionIndex].taskCount = 
                    Math.max(0, project.contributions[contributionIndex].taskCount - 1);
            }
        }

        // Get username for activity log
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Remove task
        project.tasks.splice(taskIndex, 1);

        // Add activity for task deletion
        project.activities.push({
            type: 'task_updated',
            userId,
            username,
            details: `Deleted task: ${task.title}`,
            timestamp: new Date()
        });

        await project.save();

        res.status(200).json({ message: 'Task deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting task', error });
    }
});

// Message API - Send a message
router.post('/:id/messages', authenticate, async (req, res) => {
    const { id } = req.params;
    const { text } = req.body;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to send messages in this project' });
        }

        // Get username for the message
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Create new message
        const newMessage = {
            sender: username,
            text,
            timestamp: new Date()
        };

        // Add message to project
        project.messages = project.messages || [];
        project.messages.push(newMessage);

        await project.save();

        // Socket.io is handled in server.js so we don't need to emit here
        // We just save to the database and the socket event from the client
        // will broadcast to everyone else
        
        res.status(201).json(newMessage);
    } catch (error) {
        res.status(500).json({ message: 'Error sending message', error });
    }
});

// Resource API - Add a resource
router.post('/:id/resources', authenticate, async (req, res) => {
    const { id } = req.params;
    const { title, url, type } = req.body;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to add resources to this project' });
        }

        // Get username for the resource
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Create new resource
        const newResource = {
            title,
            url,
            type,
            uploadedBy: username,
            uploadedAt: new Date()
        };

        // Add resource to project
        project.resources = project.resources || [];
        project.resources.push(newResource);

        await project.save();

        res.status(201).json(newResource);
    } catch (error) {
        res.status(500).json({ message: 'Error adding resource', error });
    }
});

// Direct Enrollment API - Add a user directly to enrolledUsers
router.post('/:id/directEnroll', authenticate, async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const requestingUserId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if the requesting user is the project owner
        if (project.userId.toString() !== requestingUserId) {
            return res.status(403).json({ message: 'Only the project owner can directly enroll users' });
        }

        // Find the user to enroll
        const userToEnroll = await User.findById(userId);
        if (!userToEnroll) {
            return res.status(404).json({ message: 'User to enroll not found' });
        }

        // Check if user is already enrolled
        if (project.enrolledUsers.some(id => id.toString() === userId)) {
            return res.status(400).json({ message: 'User is already enrolled in this project' });
        }

        // Add user to enrolledUsers
        project.enrolledUsers.push(userId);
        
        // Add activity for direct enrollment
        project.activities.push({
            type: 'enrollment_accepted',
            userId: requestingUserId,
            username: userToEnroll.username,
            details: `${userToEnroll.username} was directly enrolled by project owner`,
            timestamp: new Date()
        });
        
        await project.save();

        res.status(200).json({ 
            message: 'User enrolled successfully',
            enrolledUsers: project.enrolledUsers
        });
    } catch (error) {
        res.status(500).json({ message: 'Error enrolling user', error });
    }
});

// Debug route to view enrolled users
router.get('/:id/enrolledUsers', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Get detailed information about enrolled users
        const enrolledUsersDetails = [];
        for (const enrolledUserId of project.enrolledUsers) {
            const user = await User.findById(enrolledUserId);
            if (user) {
                enrolledUsersDetails.push({
                    userId: user._id,
                    username: user.username
                });
            } else {
                enrolledUsersDetails.push({
                    userId: enrolledUserId,
                    username: 'Unknown User'
                });
            }
        }

        res.status(200).json({
            projectId: project._id,
            projectTitle: project.title,
            enrolledUsers: enrolledUsersDetails,
            enrolledUserIds: project.enrolledUsers.map(id => id.toString())
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching enrolled users', error });
    }
});

// Get all users in a project (owner and enrolled users)
router.get('/:id/users', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to view users in this project' });
        }

        // Get owner details
        const owner = await User.findById(project.userId);
        const ownerDetails = owner ? {
            userId: owner._id,
            username: owner.username
        } : null;

        // Get enrolled users details
        const enrolledUsersDetails = [];
        for (const enrolledUserId of project.enrolledUsers) {
            const user = await User.findById(enrolledUserId);
            if (user) {
                enrolledUsersDetails.push({
                    userId: user._id,
                    username: user.username
                });
            }
        }

        // Combine owner and enrolled users
        const allUsers = [];
        if (ownerDetails) {
            allUsers.push(ownerDetails);
        }
        allUsers.push(...enrolledUsersDetails);

        res.status(200).json(allUsers);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching project users', error });
    }
});

// Update meeting status
router.patch('/:id/meeting', authenticate, async (req, res) => {
    const { id } = req.params;
    const { active, creatorUsername, roomName } = req.body;
    const userId = req.user.userId;

    try {
        console.log(`Meeting update request received: projectId=${id}, active=${active}, creator=${creatorUsername || 'null'}, roomName=${roomName || 'null'}`);
        
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to manage meetings in this project' });
        }

        // Update meeting status
        project.meetingActive = !!active; // Convert to boolean to handle undefined/null
        
        if (active) {
            project.meetingCreator = creatorUsername || null;
            project.meetingStartTime = new Date();
            project.meetingRoom = roomName || null;
            console.log(`Setting up meeting for project ${id}: creator=${project.meetingCreator}, room=${project.meetingRoom}`);
        } else {
            console.log(`Ending meeting for project ${id}`);
            project.meetingCreator = null;
            project.meetingStartTime = null;
            project.meetingRoom = null;
        }
        
        await project.save();
        console.log(`Meeting status updated successfully for project ${id}`);
        
        // Broadcast meeting status change through socket.io
        // This would happen in the actual implementation
        
        res.status(200).json({ 
            meetingActive: project.meetingActive,
            meetingCreator: project.meetingCreator,
            meetingStartTime: project.meetingStartTime,
            meetingRoom: project.meetingRoom
        });
    } catch (error) {
        console.error(`Error updating meeting status for project ${id}:`, error);
        res.status(500).json({ 
            message: 'Error updating meeting status', 
            error: error.message 
        });
    }
});

// Get whiteboard data for a project
router.get('/:id/whiteboard', authenticate, async (req, res) => {
    const { id } = req.params;
    
    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        
        // Check if user is owner or enrolled in project
        const isOwner = project.userId.toString() === req.user.userId;
        const isEnrolled = project.enrolledUsers.some(userId => 
            userId.toString() === req.user.userId
        );
        
        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ 
                message: 'Access denied: You must be the project owner or an enrolled member' 
            });
        }
        
        // Return whiteboard data or empty object if no data
        res.json({ 
            whiteboardData: project.whiteboardData || null
        });
    } catch (error) {
        console.error('Error fetching whiteboard data:', error);
        res.status(500).json({ message: 'Error fetching whiteboard data', error: error.message });
    }
});

// Save whiteboard data for a project
router.post('/:id/whiteboard', authenticate, async (req, res) => {
    const { id } = req.params;
    const { whiteboardData } = req.body;
    
    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        
        // Check if user is owner or enrolled in project
        const isOwner = project.userId.toString() === req.user.userId;
        const isEnrolled = project.enrolledUsers.some(userId => 
            userId.toString() === req.user.userId
        );
        
        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ 
                message: 'Access denied: You must be the project owner or an enrolled member' 
            });
        }
        
        console.log('Received whiteboard data:', typeof whiteboardData);
        
        // Make sure whiteboardData is not undefined or null
        if (whiteboardData === undefined || whiteboardData === null) {
            return res.status(400).json({ message: 'No whiteboard data provided' });
        }
        
        // Get username for activity log
        const user = await User.findById(req.user.userId);
        const username = user ? user.username : 'Unknown User';
        
        // Add activity for whiteboard update
        project.activities.push({
            type: 'whiteboard_update',
            userId: req.user.userId,
            username: username,
            details: 'Updated the project whiteboard',
            timestamp: new Date()
        });
        
        // Update whiteboard data
        project.whiteboardData = whiteboardData;
        await project.save();
        
        res.status(200).json({ 
            message: 'Whiteboard data saved successfully',
            savedAt: new Date()
        });
    } catch (error) {
        console.error('Error saving whiteboard data:', error);
        res.status(500).json({ message: 'Error saving whiteboard data', error: error.message });
    }
});

// Add user to project (enroll user)
router.post('/:id/users', authenticate, async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    try {
        const project = await Project.findById(id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        // Only allow the owner to add users
        if (String(project.userId) !== String(req.user.userId)) {
            return res.status(403).json({ message: 'Only the project owner can add users' });
        }

        // Check if user is already enrolled
        if (project.enrolledUsers.includes(userId)) {
            return res.status(400).json({ message: 'User already enrolled' });
        }

        // Optionally, check if user exists
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        project.enrolledUsers.push(userId);
        await project.save();

        res.json({ message: 'User added to project' });
    } catch (error) {
        res.status(500).json({ message: 'Error adding user to project', error: error.message });
    }
});

// Remove user from project (owner or self can remove)
router.delete('/:id/users/:userId', authenticate, async (req, res) => {
    const { id, userId } = req.params;
    try {
        const project = await Project.findById(id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        // Only the owner or the user themselves can remove
        if (
            String(project.userId) !== String(req.user.userId) &&
            String(userId) !== String(req.user.userId)
        ) {
            return res.status(403).json({ message: 'Not authorized to remove this user' });
        }

        // Remove user from enrolledUsers
        const before = project.enrolledUsers.length;
        project.enrolledUsers = project.enrolledUsers.filter(
            uid => String(uid) !== String(userId)
        );
        if (project.enrolledUsers.length === before) {
            return res.status(404).json({ message: 'User not enrolled in this project' });
        }
        await project.save();
        res.json({ message: 'User removed from project' });    } catch (error) {
        res.status(500).json({ message: 'Error removing user from project', error: error.message });
    }
});

// Get all scheduled meetings for a project
router.get('/:id/scheduledMeetings', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to view meetings in this project' });
        }

        res.status(200).json(project.scheduledMeetings || []);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching scheduled meetings', error: error.message });
    }
});

// Schedule a new meeting
router.post('/:id/scheduledMeetings', authenticate, async (req, res) => {
    const { id } = req.params;
    const { title, description, scheduledFor, duration } = req.body;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to schedule meetings in this project' });
        }

        // Get username for the meeting creator
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Create a unique meeting ID
        const meetingId = `meeting-${Date.now()}`;

        // Generate a unique meeting room name based on project ID and meeting ID
        const roomName = `schulen-project-${id}-${meetingId}`;

        // Create the scheduled meeting
        const newMeeting = {
            id: meetingId,
            title,
            description,
            scheduledFor: new Date(scheduledFor),
            duration: duration || 60,
            createdBy: username,
            createdAt: new Date(),
            roomName
        };

        // Add the meeting to the project
        project.scheduledMeetings = project.scheduledMeetings || [];
        project.scheduledMeetings.push(newMeeting);

        // Add a notification for all project members
        const notification = {
            type: 'meeting_scheduled',
            meetingId,
            message: `${username} scheduled a meeting: ${title} on ${new Date(scheduledFor).toLocaleString()}`,
            timestamp: new Date(),
            read: false
        };

        project.notifications = project.notifications || [];
        project.notifications.push(notification);

        // Add activity for meeting scheduling
        project.activities.push({
            type: 'meeting_scheduled',
            userId,
            username,
            details: `Scheduled a meeting: ${title} for ${new Date(scheduledFor).toLocaleString()}`,
            timestamp: new Date()
        });

        await project.save();

        // If we have Socket.io set up, emit a notification event here
        // That would be implemented in server.js

        res.status(201).json(newMeeting);
    } catch (error) {
        res.status(500).json({ message: 'Error scheduling meeting', error: error.message });
    }
});

// Delete a scheduled meeting
router.delete('/:id/scheduledMeetings/:meetingId', authenticate, async (req, res) => {
    const { id, meetingId } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if meeting exists
        const meetingIndex = project.scheduledMeetings ? 
            project.scheduledMeetings.findIndex(meeting => meeting.id === meetingId) : -1;

        if (meetingIndex === -1) {
            return res.status(404).json({ message: 'Scheduled meeting not found' });
        }

        const meeting = project.scheduledMeetings[meetingIndex];

        // Get username for authorization check
        const user = await User.findById(userId);
        const username = user ? user.username : 'Unknown User';

        // Only the meeting creator or project owner can delete a meeting
        const isOwner = project.userId.toString() === userId;
        const isCreator = meeting.createdBy === username;

        if (!isOwner && !isCreator) {
            return res.status(403).json({ message: 'You do not have permission to delete this meeting' });
        }

        // Remove the meeting
        project.scheduledMeetings.splice(meetingIndex, 1);

        // Add activity for meeting deletion
        project.activities.push({
            type: 'meeting_scheduled', // Reuse the same activity type
            userId,
            username,
            details: `Deleted scheduled meeting: ${meeting.title}`,
            timestamp: new Date()
        });

        await project.save();

        res.status(200).json({ message: 'Scheduled meeting deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting scheduled meeting', error: error.message });
    }
});

// Get notifications for a project
router.get('/:id/notifications', authenticate, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to view notifications in this project' });
        }

        res.status(200).json(project.notifications || []);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notifications', error: error.message });
    }
});

// Mark notification as read
router.patch('/:id/notifications/:notificationIndex/read', authenticate, async (req, res) => {
    const { id, notificationIndex } = req.params;
    const userId = req.user.userId;

    try {
        const project = await Project.findById(id);
        
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user has access to this project
        const isOwner = project.userId.toString() === userId;
        const isEnrolled = project.enrolledUsers.some(
            enrolledUserId => enrolledUserId.toString() === userId
        );

        if (!isOwner && !isEnrolled) {
            return res.status(403).json({ message: 'You do not have permission to modify notifications in this project' });
        }

        // Check if notification exists
        const index = parseInt(notificationIndex);
        if (!project.notifications || !project.notifications[index]) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        // Mark notification as read
        project.notifications[index].read = true;
        await project.save();

        res.status(200).json({ message: 'Notification marked as read' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notification', error: error.message });
    }
});

module.exports = router;