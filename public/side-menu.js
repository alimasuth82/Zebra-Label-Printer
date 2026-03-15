// ===========================
// Side Menu Controls
// ===========================

/**
 * Opens the transaction selection menu
 * Activates overlay and prevents body scrolling
 */
function selectTransaction() {
    const transactionMenu = document.getElementById('transactionMenu');
    const overlay = document.getElementById('overlay');
    
    transactionMenu.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Closes the transaction selection menu
 * Removes overlay and restores body scrolling
 */
function closeTransactionMenu() {
    const transactionMenu = document.getElementById('transactionMenu');
    const overlay = document.getElementById('overlay');
    
    transactionMenu.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// ===========================
// User Menu Toggle
// ===========================

/**
 * Initialize user menu dropdown toggle
 */
window.addEventListener('DOMContentLoaded', () => {
    const userMenuToggle = document.getElementById('userMenuToggle');
    const userDropdown = document.getElementById('userDropdown');
    
    if (userMenuToggle && userDropdown) {
        userMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('active');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userMenuToggle.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.classList.remove('active');
            }
        });
    }
});