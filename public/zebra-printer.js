function printLabels() {
    if (!state.selectedOrder?.serviceItems?.length) {
        alert("Please select an order with service items first.");
        return;
    }

    const printContainer = document.createElement('div');
    printContainer.id = 'print-labels-container';
    printContainer.style.display = 'none';
    
    state.selectedOrder.serviceItems.forEach((item, index) => {
        // Get the copy count for this item
        const copyCountKey = `${state.selectedOrder.id}-${index}`;
        const copyCount = state.copyCounts[copyCountKey] || 1;
        
        // Create the specified number of copies
        for (let copy = 0; copy < copyCount; copy++) {
            const labelDiv = document.createElement('div');
            labelDiv.className = 'print-label';
            
            // Build details string
            const details = [];
            if (item.modifiers) item.modifiers.forEach(m => details.push(m.name.toUpperCase()));
            if (item.note) details.push(item.note.toUpperCase());
            const detailsText = details.length > 0 ? details.join(' / ') : 'STANDARD SERVICE';

            labelDiv.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:9pt;">
                    <span>${state.selectedOrder.displayNumber}</span>
                    <span style="flex:1; text-align:center;">${state.selectedOrder.customerName.toUpperCase()}</span>
                    <span>${index + 1}/${state.selectedOrder.serviceItems.length}</span>
                </div>
                <br>
                <div style="text-align:center; flex:1; display:flex; flex-direction:column; justify-content:center;">
                    <h2 style="font-size:11pt; margin:0;">${item.name.toUpperCase()}</h2>
                    <div style="width:100%; height:1px; background:#000; margin:3pt 0;"></div>
                    <p style="font-size:7pt; margin:0;">${detailsText}</p>
                </div>
            `;
            printContainer.appendChild(labelDiv);
        }
    });
    
    document.body.appendChild(printContainer);
    setTimeout(() => {
        window.print();
        document.body.removeChild(printContainer);
    }, 200);
}
