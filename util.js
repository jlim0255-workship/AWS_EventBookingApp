const API_BASE_URL = "https://kulybaaq0e.execute-api.ap-southeast-1.amazonaws.com";

function formatDate(dateString){
    if (!dateString) {return "Date To Be Announced"};
    return new Date(dateString).toLocaleDateString('en-MY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: `numeric`
    });
}

function formatTime(dateString){
    if (!dateString) {return "Date To Be Announced"};
    return new Date(dateString).toLocaleDateString('en-MY', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function closeModal(){
    document.getElementById("eventModal").style.display = "none";
}

window.onclick = function(event) {
    const modal = document.getElementById("eventModal");
    if (event.target == modal) {
        closeModal();
    }
}

async function apiCall(endpoint, options={}) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        const data = await response.json();

        if (!response.ok) {
            // use the backend's error message if available
            const errorMessage = data.message || `API error: ${response.status}`;
            throw new Error(errorMessage);
        }

        return data;
        
    } catch (error) {
        console.error("API call failed:", error);
        throw error;
    }
}