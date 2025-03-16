import React, { useState, useEffect } from 'react';
import './MyProjects.css';
import { useNavigate, Link } from 'react-router-dom';
import { Header } from './Header';
import config from '../config';
import { FontAwesomeIcon } from '../fontawesome';
import { 
  faProjectDiagram, 
  faFolderOpen, 
  faEnvelope, 
  faSignOutAlt,
  faPlus
} from '@fortawesome/free-solid-svg-icons';

export const MyProjects = () => {
    const [createdProjects, setCreatedProjects] = useState([]);
    const [enrolledProjects, setEnrolledProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const username = localStorage.getItem('username'); // This is the username
    const token = localStorage.getItem('token');
    const [userId, setUserId] = useState(localStorage.getItem('userId')); // This might be the actual userId if stored
    const [projectCreators, setProjectCreators] = useState({}); // Store username for each project creator

    useEffect(() => {
        // Fetch the user's ID if not already stored
        if (!userId && username) {
            fetchUserId();
        } else {
            // Fetch both created and enrolled projects when component mounts
            fetchCreatedProjects();
            fetchEnrolledProjects();
        }
    }, []);

    // Fetch the user's ID from the backend
    const fetchUserId = async () => {
        try {
            // Try to get the user ID by username
            const response = await fetch(`${config.API_BASE_URL}/browseprojects/user/byUsername/${username}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.userId) {
                    console.log('Fetched userId:', data.userId);
                    setUserId(data.userId);
                    localStorage.setItem('userId', data.userId);
                    
                    // Now fetch projects with the correct userId
                    fetchCreatedProjects(data.userId);
                    fetchEnrolledProjects(data.userId);
                } else {
                    console.error('User ID not found in response:', data);
                    // Try to fetch projects anyway using username
                    fetchCreatedProjects();
                    fetchEnrolledProjects();
                }
            } else {
                console.error('Failed to fetch user ID, status:', response.status);
                // Try to fetch projects anyway using username
                fetchCreatedProjects();
                fetchEnrolledProjects();
            }
        } catch (error) {
            console.error('Error fetching user ID:', error);
            // Try to fetch projects anyway using username
            fetchCreatedProjects();
            fetchEnrolledProjects();
        }
    };

    // Fetch username for a project creator
    const fetchProjectCreatorUsername = async (creatorId) => {
        if (projectCreators[creatorId]) {
            return projectCreators[creatorId];
        }
        
        try {
            const response = await fetch(`${config.API_BASE_URL}/browseprojects/user/${creatorId}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.username) {
                    // Store username in state for future reference
                    setProjectCreators(prev => ({
                        ...prev,
                        [creatorId]: data.username
                    }));
                    return data.username;
                }
            }
        } catch (error) {
            console.error('Error fetching project creator username:', error);
        }
        return null;
    };

    // Fetch projects created by the user
    const fetchCreatedProjects = async (userIdToUse = userId) => {
        if (!username || !token) {
            console.error('Missing username or token:', { username, token: !!token });
            return;
        }

        try {
            setLoading(true);
            console.log('Fetching projects with userId:', userIdToUse || username);
            
            // Use the main projects endpoint and filter on client side
            const response = await fetch(`${config.API_BASE_URL}/browseprojects`, {
                headers: {
                    // Try without 'Bearer ' prefix as it might not be expected by the API
                    'Authorization': token
                }
            });

            if (response.ok) {
                const allProjects = await response.json();
                console.log('All projects:', allProjects);
                
                // First, try to match by userId if we have it
                let userProjects = [];
                
                if (userIdToUse) {
                    // If we have a userId, use it for comparison
                    userProjects = allProjects.filter(project => {
                        console.log('Comparing project.userId:', project.userId, 'with userId:', userIdToUse);
                        return String(project.userId) === String(userIdToUse);
                    });
                }
                
                // If no projects found by userId or we don't have userId, try to match by username
                if (userProjects.length === 0) {
                    console.log('No projects found by userId, trying to match by username');
                    
                    // We need to fetch the username for each project creator
                    const projectsWithCreators = await Promise.all(
                        allProjects.map(async (project) => {
                            const creatorUsername = await fetchProjectCreatorUsername(project.userId);
                            return {
                                ...project,
                                creatorUsername
                            };
                        })
                    );
                    
                    // Now filter by username
                    userProjects = projectsWithCreators.filter(project => {
                        console.log('Comparing project.creatorUsername:', project.creatorUsername, 'with username:', username);
                        return project.creatorUsername === username;
                    });
                }
                
                console.log('Filtered user projects:', userProjects);
                setCreatedProjects(userProjects);
            } else {
                console.error('Failed to fetch projects, status:', response.status);
                try {
                    const errorData = await response.json();
                    console.error('Error details:', errorData);
                } catch (e) {
                    console.error('Could not parse error response');
                }
                setCreatedProjects([]);
            }
        } catch (error) {
            console.error('Error fetching created projects:', error);
            setCreatedProjects([]);
        } finally {
            setLoading(false);
        }
    };

    // Fetch projects where the user is enrolled
    const fetchEnrolledProjects = async (userIdToUse = userId) => {
        if (!username || !token) {
            console.error('Missing username or token for fetchEnrolledProjects');
            return;
        }

        try {
            setLoading(true);
            
            // Use the new enrollments API endpoint
            const userIdentifier = userIdToUse || username;
            console.log('Fetching enrollments for user:', userIdentifier);
            const response = await fetch(`${config.API_BASE_URL}/enrollments/user/${userIdentifier}`, {
                headers: {
                    'Authorization': token
                },
                // Add timeout to prevent long waiting if endpoint doesn't respond
                signal: AbortSignal.timeout(5000)
            });
            
            if (response.ok) {
                const enrollmentsData = await response.json();
                console.log('Enrollments data:', enrollmentsData);
                
                // Filter only accepted enrollments
                const acceptedEnrollments = enrollmentsData.filter(enrollment => enrollment.status === "accepted");
                console.log('Accepted enrollments:', acceptedEnrollments);
                
                if (acceptedEnrollments.length > 0) {
                    // Extract the project details from the populated data
                    const enrolledProjects = [];
                    
                    // Check if projectId is a full object or just an ID
                    for (const enrollment of acceptedEnrollments) {
                        if (enrollment.projectId && typeof enrollment.projectId === 'object') {
                            // If it's a full object, add it directly
                            enrolledProjects.push(enrollment.projectId);
                        } else {
                            // If it's just an ID, we need to fetch the project details
                            try {
                                const projectResponse = await fetch(`${config.API_BASE_URL}/browseprojects/${enrollment.projectId}`);
                                if (projectResponse.ok) {
                                    const project = await projectResponse.json();
                                    enrolledProjects.push(project);
                                }
                            } catch (error) {
                                console.error('Error fetching project details:', error);
                            }
                        }
                    }
                    
                    console.log('Enrolled projects:', enrolledProjects);
                    setEnrolledProjects(enrolledProjects);
                } else {
                    console.log('No accepted enrollments found');
                    setEnrolledProjects([]);
                }
                return;
            } else {
                console.error('Failed to fetch enrollments, status:', response.status);
                
                // Fallback to localStorage for stored enrollments
                const storedEnrollments = localStorage.getItem('enrolledProjects');
                if (storedEnrollments) {
                    console.log('Using stored enrollments from localStorage');
                    
                    try {
                        // Fetch all projects
                        const allProjectsResponse = await fetch(`${config.API_BASE_URL}/browseprojects`);
                        if (allProjectsResponse.ok) {
                            const allProjects = await allProjectsResponse.json();
                            
                            // Filter projects that match the stored enrolled project IDs
                            const enrolledProjectIds = JSON.parse(storedEnrollments);
                            const enrolledProjects = allProjects.filter(project => 
                                enrolledProjectIds.includes(project._id)
                            );
                            
                            setEnrolledProjects(enrolledProjects);
                            return;
                        }
                    } catch (error) {
                        console.error('Error fetching projects for stored enrollments:', error);
                    }
                }
            }
            
            // If all else fails, use empty array
            setEnrolledProjects([]);
            
        } catch (error) {
            console.error('Error in fetchEnrolledProjects:', error);
            setEnrolledProjects([]);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
        navigate('/login');
    };

    const handleDeleteProject = async (projectId) => {
        if (window.confirm('Are you sure you want to delete this project?')) {
            try {
                const response = await fetch(`${config.API_BASE_URL}/browseprojects/${projectId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    // Remove the deleted project from the state
                    setCreatedProjects(createdProjects.filter(project => project._id !== projectId));
                    alert('Project deleted successfully');
                } else {
                    const data = await response.json();
                    alert(data.message || 'Failed to delete project');
                }
            } catch (error) {
                console.error('Error deleting project:', error);
                alert('An error occurred while deleting the project');
            }
        }
    };

    const handleChangeStatus = async (projectId, newStatus) => {
        try {
            const response = await fetch(`${config.API_BASE_URL}/browseprojects/${projectId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });

            if (response.ok) {
                // Update the project status in the state
                setCreatedProjects(createdProjects.map(project => 
                    project._id === projectId ? { ...project, status: newStatus } : project
                ));
                alert(`Project status changed to ${newStatus}`);
            } else {
                const data = await response.json();
                alert(data.message || 'Failed to change project status');
            }
        } catch (error) {
            console.error('Error changing project status:', error);
            alert('An error occurred while changing the project status');
        }
    };

    // Render a project card
    const renderProjectCard = (project, isCreated = false) => (
        <div key={project._id} className="project-card">
            <p id="browseprojectcardtitle">{project.title}</p>
            <div className={`status-box ${project.status === 'Open' ? 'status-open' : project.status === 'Closed' ? 'status-closed' : 'status-inprogress'}`}>
                {project.status}
            </div>
            
            <p><strong>Deadline:</strong> {project.deadline}</p>
            <p><strong>Domain:</strong> {project.domain}</p>
            
            {isCreated && (
                <div className="options" onClick={(e) => e.stopPropagation()}>
                    <button className="options-button" onClick={(e) => {
                        const optionsMenu = e.target.nextElementSibling;
                        optionsMenu.style.display = optionsMenu.style.display === 'block' ? 'none' : 'block';
                    }}>⋮</button>
                    <div className="options-menu">
                        <button onClick={() => handleDeleteProject(project._id)} id="projdelete">Delete</button>
                        {project.status !== 'Open' && (
                            <button onClick={() => handleChangeStatus(project._id, 'Open')}>Open</button>
                        )}
                        {project.status !== 'In Progress' && (
                            <button onClick={() => handleChangeStatus(project._id, 'In Progress')}>In Progress</button>
                        )}
                        {project.status !== 'Closed' && (
                            <button onClick={() => handleChangeStatus(project._id, 'Closed')}>Close</button>
                        )}
                    </div>
                </div>
            )}
            
            <div className="project-card-footer">
                {!isCreated && (
                    <div className="enrollment-status">
                        Enrolled
                    </div>
                )}
                <button className="view-project-button" onClick={() => navigate(`/main/browseprojects/${project._id}`)}>
                    View Project
                </button>
            </div>
        </div>
    );

    return (
        <div className="main-container">
            <Header />
            <div className="my-projects-container">
                <h1>My Projects</h1>

                <nav className="main_elements">
                    <ul>
                        <li>
                            <Link to="/main/browseprojects">
                                <FontAwesomeIcon icon={faProjectDiagram} className="nav-icon" />
                                <span>Browse Projects</span>
                            </Link>
                        </li>
                        <li>
                            <Link to="/main/myprojects" className="active">
                                <FontAwesomeIcon icon={faFolderOpen} className="nav-icon" />
                                <span>My Projects</span>
                            </Link>
                        </li>
                        <li>
                            <Link to="/messages">
                                <FontAwesomeIcon icon={faEnvelope} className="nav-icon" />
                                <span>Messages</span>
                            </Link>
                        </li>
                        <li>
                            <button onClick={handleLogout}>
                                <FontAwesomeIcon icon={faSignOutAlt} className="nav-icon" />
                                <span>Logout</span>
                            </button>
                        </li>
                    </ul>
                </nav>
                
                <div className="content">
                    <div className="my-projects-container">
                        <div className="section">
                            <div className="section-header">
                                <h2>My Created Projects</h2>
                                <button 
                                    className="create-project-button" 
                                    onClick={() => navigate('/main/browseprojects')}
                                    title="Create a new project"
                                >
                                    <FontAwesomeIcon icon={faPlus} /> Create Project
                                </button>
                            </div>
                            
                            <div className="project-cards">
                                {loading ? (
                                    <div className="loading-message">Loading your projects...</div>
                                ) : createdProjects.length === 0 ? (
                                    <div className="empty-message">
                                        <p>You haven't created any projects yet.</p>
                                        <button 
                                            className="create-first-project-button"
                                            onClick={() => navigate('/main/browseprojects')}
                                        >
                                            Create Your First Project
                                        </button>
                                    </div>
                                ) : (
                                    createdProjects.map(project => renderProjectCard(project, true))
                                )}
                            </div>
                        </div>
                        
                        <div className="section">
                            <div className="section-header">
                                <h2>Projects I'm Enrolled In</h2>
                            </div>
                            
                            <div className="project-cards">
                                {loading ? (
                                    <div className="loading-message">Loading enrolled projects...</div>
                                ) : enrolledProjects.length === 0 ? (
                                    <div className="empty-message">
                                        <p>You're not enrolled in any projects yet.</p>
                                        <button 
                                            className="browse-projects-button"
                                            onClick={() => navigate('/main/browseprojects')}
                                        >
                                            Browse Available Projects
                                        </button>
                                    </div>
                                ) : (
                                    enrolledProjects.map(project => renderProjectCard(project, false))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}; 