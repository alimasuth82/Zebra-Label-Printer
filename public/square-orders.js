// square-orders.js

// 1. GLOBAL STATE
// This is the "brain" of the app, holding all current data in one place.
let state = {
    allOrders: [],
    filteredOrders: [],
    selectedOrder: null,
    currentItemIndex: 0,
    merchantId: null,
    pollInterval: null,
    copyCounts: {}, // Track copy counts for each item: "orderId-itemIndex" -> count
    restoredSelection: false, // Ensure we only restore selection once per session
};

// 2. INITIALIZATION
// All setup logic happens here when the page first loads.
window.addEventListener('DOMContentLoaded', () => {
    // A. Get Merchant ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    state.merchantId = urlParams.get('merchant_id');
    
    if (state.merchantId) {
        fetchMerchantInfo();
        onUserSignedIn();
        fetchOrders();
    }

    // B. Setup Search Listener
    const searchInput = document.getElementById('transactionSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            handleSearch(e.target.value.toLowerCase());
        });
    }
});

// 3. DATA FETCHING (Talking to your server.js)
async function fetchOrders() {
    try {
        const response = await fetch(`/api/orders?merchant_id=${state.merchantId}`);
        const data = await response.json();

        if (data.orders) {
            // Filter: Only show actual sales (exclude canceled/refunds)
            const newOrders = data.orders.filter(order => {
                const isCanceled = order.state === 'CANCELED';
                const hasRefunds = order.refunds && order.refunds.length > 0;
                return !isCanceled && !hasRefunds;
            });
            
            // Check if there are new orders
            const previousOrderCount = state.allOrders.length;
            state.allOrders = newOrders;
            
            // Refresh filtered orders to include new ones, maintaining search
            const searchInput = document.getElementById('transactionSearch');
            if (searchInput && searchInput.value) {
                handleSearch(searchInput.value.toLowerCase());
            } else {
                state.filteredOrders = [...state.allOrders];
                displayOrders(state.filteredOrders);
            }

            // Attempt to restore the last selected order once orders are loaded
            tryRestoreSelectedOrder();

            // If nothing was restored, reset the placeholder text
            if (!state.selectedOrder) {
                resetLabelPlaceholder();
            }
        }
    } catch (error) {
        console.error('Error loading orders:', error);
        showErrorMessage('Failed to load transactions');
    }
}

async function fetchMerchantInfo() {
    try {
        const response = await fetch(`/api/merchant?merchant_id=${state.merchantId}`);
        const data = await response.json();
        if (data.merchant_name) {
            document.getElementById('signInBtn').style.display = 'none';
            const userMenu = document.getElementById('userMenu');
            userMenu.style.display = 'block';
            document.getElementById('userName').textContent = data.merchant_name;
        }
    } catch (error) {
        console.error('Error fetching merchant info:', error);
    }
}

// Helper function to format ticket numbers
function formatTicketNumber(referenceId, ticketName, fallbackNumber) {
    // Check if API returned a ticket value
    const apiTicket = referenceId || ticketName;
    
    if (apiTicket) {
        // API returned a value - check if it's purely numeric
        if (/^\d+$/.test(apiTicket)) {
            return `#${apiTicket}`;
        } else {
            // API returned non-numeric value
            return '#N/A';
        }
    } else {
        // No API ticket value
        return '#N/A';
    }
}

// LocalStorage helpers to persist the selected order across refreshes
function getSelectionStorageKey(key) {
    if (!state.merchantId) return null;
    return `zebra-label-printer:${state.merchantId}:${key}`;
}

function saveSelectedOrder(orderId, itemIndex = 0) {
    const orderKey = getSelectionStorageKey('orderId');
    const itemKey = getSelectionStorageKey('itemIndex');
    if (!orderKey || !itemKey) return;

    localStorage.setItem(orderKey, orderId);
    localStorage.setItem(itemKey, String(itemIndex));
}

function clearSelectedOrderStorage() {
    const orderKey = getSelectionStorageKey('orderId');
    const itemKey = getSelectionStorageKey('itemIndex');
    if (orderKey) localStorage.removeItem(orderKey);
    if (itemKey) localStorage.removeItem(itemKey);
}

function tryRestoreSelectedOrder() {
    if (state.restoredSelection) return;
    state.restoredSelection = true;

    const orderKey = getSelectionStorageKey('orderId');
    if (!orderKey) return;

    const storedOrderId = localStorage.getItem(orderKey);
    if (!storedOrderId) return;

    const order = state.allOrders.find(o => o.id === storedOrderId);
    if (!order) {
        clearSelectedOrderStorage();
        return;
    }

    const itemKey = getSelectionStorageKey('itemIndex');
    let storedIndex = 0;
    if (itemKey) {
        const raw = localStorage.getItem(itemKey);
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) storedIndex = parsed;
    }

    const serviceItems = (order.line_items || []).filter(item => item.product_type !== 'REGULAR');
    if (storedIndex < 0 || storedIndex >= serviceItems.length) storedIndex = 0;

    const orderNumber = state.allOrders.length - state.allOrders.indexOf(order);
    selectOrder(order, orderNumber, storedIndex);
}

// 4. CORE APP LOGIC
function selectOrder(order, orderNumber, itemIndex = 0) {
    state.selectedOrder = order;
    state.currentItemIndex = itemIndex;

    // Set display number (Reference ID > Ticket Name > Sequential Number)
    state.selectedOrder.displayNumber = formatTicketNumber(
        order.reference_id, 
        order.ticket_name, 
        orderNumber
    );
    state.selectedOrder.customerName = getCustomerName(order);

    // Filter for Service Items (tagged by our server)
    state.selectedOrder.serviceItems = (order.line_items || []).filter(item => 
        item.product_type !== 'REGULAR'
    );

    // Enable the copy buttons now that a transaction is selected
    const copyBtns = document.querySelectorAll('.copy-btn');
    copyBtns.forEach(btn => btn.disabled = false);

    // Persist the selected order so it can be restored on refresh
    saveSelectedOrder(order.id, state.currentItemIndex);

    displayCurrentItem();
    closeTransactionMenu();
}

function handleSearch(searchTerm) {
    if (searchTerm === '') {
        state.filteredOrders = [...state.allOrders];
    } else {
        state.filteredOrders = state.allOrders.filter(order => {
            const customerName = (getCustomerName(order) || '').toLowerCase();
            const ticketId = (order.reference_id || order.ticket_name || '').toLowerCase();
            
            // Search by total amount
            const totalMoney = order.total_money ? formatMoney(order.total_money) : '';
            const totalSearchable = totalMoney.toLowerCase();
            
            // Search by item details (names, modifiers, notes)
            const itemsSearchable = (order.line_items || [])
                .map(item => {
                    const name = (item.name || '').toLowerCase();
                    const modifiers = item.modifiers ? item.modifiers.map(m => m.name.toLowerCase()).join(' ') : '';
                    const note = (item.note || '').toLowerCase();
                    return `${name} ${modifiers} ${note}`;
                })
                .join(' ');
            
            return (
                customerName.includes(searchTerm) || 
                ticketId.includes(searchTerm) ||
                totalSearchable.includes(searchTerm) ||
                itemsSearchable.includes(searchTerm)
            );
        });
    }
    displayOrders(state.filteredOrders);
}

// 5. UI RENDERING
function displayOrders(orders) {
    const contentElement = document.querySelector('.side-menu-content');
    const existingList = document.getElementById('ordersList');
    if (existingList) existingList.remove();
    
    // Remove the loading/sign-in message
    const existingMessage = contentElement.querySelector('p:not(.no-orders)');
    if (existingMessage) existingMessage.remove();

    const ordersContainer = document.createElement('div');
    ordersContainer.id = 'ordersList';
    ordersContainer.className = 'orders-list';

    if (orders.length === 0) {
        ordersContainer.innerHTML = '<p class="no-orders">No transactions found</p>';
    } else {
        orders.forEach((order) => {
            const orderNumber = state.allOrders.length - state.allOrders.indexOf(order);
            const card = createOrderCard(order, orderNumber);
            ordersContainer.appendChild(card);
        });
    }
    contentElement.appendChild(ordersContainer);
}

function createOrderCard(order, orderNumber) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.onclick = () => selectOrder(order, orderNumber);

    const ticketDisplay = formatTicketNumber(
        order.reference_id, 
        order.ticket_name, 
        orderNumber
    );
    const totalMoney = order.total_money ? formatMoney(order.total_money) : '$0.00';
    const customerName = getCustomerName(order);

    // Extract service items (same logic as selectOrder)
    const serviceItems = (order.line_items || []).filter(item => 
        item.product_type !== 'REGULAR'
    );

    // Build items details
    let itemsHTML = '';
    if (serviceItems.length > 0) {
        serviceItems.forEach((item, idx) => {
            const modifiers = item.modifiers ? item.modifiers.map(m => m.name).join(', ') : '';
            itemsHTML += `
                <div class="order-item">
                    <p class="item-name"><strong>${item.name}</strong></p>
                    ${modifiers ? `<p class="item-modifiers">${modifiers}</p>` : ''}
                    ${item.note ? `<p class="item-note">${item.note}</p>` : ''}
                </div>
            `;
        });
    } else {
        itemsHTML = '<p class="no-items">No service items</p>';
    }

    card.innerHTML = `
        <div class="order-card-header">
            <h3>${customerName}</h3>
            <span class="order-state ${order.state.toLowerCase()}">${order.state}</span>
        </div>
        <div class="order-card-body">
            <p><strong>Ticket #:</strong> ${ticketDisplay}</p>
            <p><strong>Total:</strong> ${totalMoney}</p>
            <div class="order-items">
                ${itemsHTML}
            </div>
        </div>
    `;
    return card;
}

function displayCurrentItem() {
    const { selectedOrder, currentItemIndex } = state;
    if (!selectedOrder) return;

    const items = selectedOrder.serviceItems || [];
    const item = items[currentItemIndex];

    document.querySelector('.order-number').textContent = selectedOrder.displayNumber;
    document.querySelector('.item-count').textContent = items.length > 0 ? `${currentItemIndex + 1}/${items.length}` : '0/0';
    
    const customerEl = document.getElementById('customerName');
    customerEl.textContent = (selectedOrder.customerName || 'GUEST CUSTOMER').toUpperCase();
    customerEl.style.display = 'block';
    document.getElementById('customerNamePlaceholder').style.display = 'none';

    const itemNameEl = document.querySelector('.item-name');
    itemNameEl.textContent = item ? item.name.toUpperCase() : 'NO SERVICE ITEMS';

    const details = [];
    if (item?.modifiers) item.modifiers.forEach(m => details.push(m.name.toUpperCase()));
    if (item?.note) details.push(item.note.toUpperCase());
    
    document.querySelector('.item-details').textContent = details.length > 0 ? details.join(' / ') : 'STANDARD SERVICE';
    
    // Initialize or get copy count for this item
    const copyCountKey = `${selectedOrder.id}-${currentItemIndex}`;
    if (!state.copyCounts[copyCountKey]) {
        state.copyCounts[copyCountKey] = 1;
    }
    
    // Update the copies display
    document.getElementById('copiesDisplay').textContent = state.copyCounts[copyCountKey];
    
    // Update navigation button states
    updateNavigationButtons();
}

// 6. NAVIGATION & UTILS
function nextLabel() {
    if (!state.selectedOrder?.serviceItems?.length) return;
    state.currentItemIndex = (state.currentItemIndex + 1) % state.selectedOrder.serviceItems.length;
    saveSelectedOrder(state.selectedOrder.id, state.currentItemIndex);
    displayCurrentItem();
}

function previousLabel() {
    if (!state.selectedOrder?.serviceItems?.length) return;
    state.currentItemIndex = (state.currentItemIndex - 1 + state.selectedOrder.serviceItems.length) % state.selectedOrder.serviceItems.length;
    saveSelectedOrder(state.selectedOrder.id, state.currentItemIndex);
    displayCurrentItem();
}

function updateNavigationButtons() {
    const prevBtn = document.getElementById('prevLabelBtn');
    const nextBtn = document.getElementById('nextLabelBtn');
    const hasItems = state.selectedOrder?.serviceItems?.length > 0;
    const isSingleItem = state.selectedOrder?.serviceItems?.length === 1;
    
    if (prevBtn && nextBtn) {
        // Disable if no items or only one item
        prevBtn.disabled = !hasItems || isSingleItem;
        nextBtn.disabled = !hasItems || isSingleItem;
    }
}

// Copy count functions
function incrementCopies() {
    const { selectedOrder, currentItemIndex } = state;
    if (!selectedOrder) return;
    
    const copyCountKey = `${selectedOrder.id}-${currentItemIndex}`;
    if (state.copyCounts[copyCountKey] < 3) { // Max 3 copies
        state.copyCounts[copyCountKey]++;
        document.getElementById('copiesDisplay').textContent = state.copyCounts[copyCountKey];
    }
}

function decrementCopies() {
    const { selectedOrder, currentItemIndex } = state;
    if (!selectedOrder) return;
    
    const copyCountKey = `${selectedOrder.id}-${currentItemIndex}`;
    if (state.copyCounts[copyCountKey] > 1) {
        state.copyCounts[copyCountKey]--;
        document.getElementById('copiesDisplay').textContent = state.copyCounts[copyCountKey];
    }
}

function onUserSignedIn() {
    document.getElementById('searchContainer').classList.remove('hidden');
    const msg = document.querySelector('.side-menu-content p');
    if (msg) msg.textContent = 'Loading transactions...';

    // Show reload placeholder until we have order details
    setReloadingText();
    
    // Start polling for new orders every 5 seconds
    startPolling();
}

function startPolling() {
    // Clear any existing polling
    if (state.pollInterval) {
        clearInterval(state.pollInterval);
    }
    
    // Poll every 5 seconds for new orders
    state.pollInterval = setInterval(() => {
        fetchOrders();
    }, 5000);
}

function getCustomerName(order) {
    if (order.customer) {
        return `${order.customer.given_name || ''} ${order.customer.family_name || ''}`.trim();
    }
    const fulfillment = order.fulfillments?.[0];
    const recipient = fulfillment?.pickup_details?.recipient || fulfillment?.shipment_details?.recipient;
    return recipient?.display_name || 'GUEST CUSTOMER';
}

function formatMoney(money) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: money.currency || 'USD',
    }).format(money.amount / 100);
}

function setReloadingText() {
    const orderNumberEl = document.querySelector('.order-number');
    const itemCountEl = document.querySelector('.item-count');
    const itemNameEl = document.querySelector('.item-name');
    const itemDetailsEl = document.querySelector('.item-details');

    if (orderNumberEl) orderNumberEl.textContent = '#--';
    if (itemCountEl) itemCountEl.textContent = '-/-';
    if (itemNameEl) itemNameEl.textContent = 'YOUR ORDER IS LOADING';
    if (itemDetailsEl) itemDetailsEl.textContent = 'PLEASE WAIT MOMENTARILY';
}

function resetLabelPlaceholder() {
    const itemNameEl = document.querySelector('.item-name');
    const itemDetailsEl = document.querySelector('.item-details');

    if (itemNameEl) itemNameEl.textContent = 'SELECT TRANSACTION';
    if (itemDetailsEl) itemDetailsEl.textContent = 'CHOOSE AN ORDER TO VIEW DETAILS';
}

function showErrorMessage(message) {
    const msg = document.querySelector('.side-menu-content p');
    if (msg) {
        msg.textContent = message;
        msg.style.color = '#d32f2f';
    }
}

function signOut() {
    // Stop polling
    if (state.pollInterval) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
    }
    
    // Clear stored selection (so next user sees a blank slate)
    clearSelectedOrderStorage();

    // Clear state
    state = {
        allOrders: [],
        filteredOrders: [],
        selectedOrder: null,
        currentItemIndex: 0,
        merchantId: null,
        pollInterval: null,
        copyCounts: {},
        restoredSelection: false
    };
    
    // Disable all buttons
    document.getElementById('prevLabelBtn').disabled = true;
    document.getElementById('nextLabelBtn').disabled = true;
    const copyBtns = document.querySelectorAll('.copy-btn');
    copyBtns.forEach(btn => btn.disabled = true);
    
    // Reset UI
    document.getElementById('userMenu').style.display = 'none';
    document.getElementById('signInBtn').style.display = 'block';
    document.getElementById('searchContainer').classList.add('hidden');
    
    // Reset label display
    document.querySelector('.order-number').textContent = '#--';
    document.querySelector('.item-count').textContent = '-/-';
    document.getElementById('customerName').style.display = 'none';
    document.getElementById('customerNamePlaceholder').style.display = 'block';
    document.querySelector('.item-name').textContent = 'SELECT TRANSACTION';
    document.querySelector('.item-details').textContent = 'CHOOSE AN ORDER TO VIEW DETAILS';
    document.getElementById('copiesDisplay').textContent = '1';
    
    // Clear URL parameters and redirect
    window.location.href = window.location.pathname;
}