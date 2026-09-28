// Reference-inspired CMT layout. All papers and identity labels are synthetic.
(() => {
    const heading=document.createElement('div');
    heading.innerHTML='<nav class="recording-nav"><span>Contact Chairs</span><span>Help Center</span><span>Select Your Role : &nbsp; <b>Reviewer ▾</b></span><span>Conference ▾</span><span>Reviewer Name ▾</span></nav><h1 class="recording-heading">Reviewer Console</h1><div class="recording-toolbar"><div class="recording-tabs"><span>All</span><b>Bidding</b><span>Reviewing</span></div><div class="recording-counts"><span>Not<br>Willing</span><b>XX</b><span>In A<br>Pinch</span><b>XX</b><span>Willing</span><b>XX</b><span>Eager</span><b>XX</b></div><b>1 - XXX of XXX</b><div class="recording-tools"><i>«</i><i>‹</i><i>1</i><i>›</i><i>»</i></div><div class="recording-tools"><b>Show:</b><i class="selected">25</i><i>50</i><i>100</i><i>All</i></div><div class="recording-tools"><i>Clear All Filters</i><i>Actions ▾</i></div></div>';
    document.body.prepend(heading);
    const table=document.querySelector('table');
    const cols=document.createElement('colgroup');
    [6,32,7,15,8,14,7,6,6].forEach(width=>{const col=document.createElement('col');col.style.width=width+'%';cols.append(col)});
    table.prepend(cols);
    document.querySelectorAll('thead tr:last-child th').forEach(cell=>{cell.setAttribute('data-bind','filter: demo');cell.innerHTML='<div class="recording-filter"></div><span class="recording-clear">Clear</span>';});
    document.querySelector('[data-sort="PrimarySubject"]').textContent='Primary';
    document.querySelector('[data-sort="SecondarySubject"]').textContent='Secondary';
    const launch = document.getElementById('launch');
    document.querySelector('.recording-heading').before(launch);
})();
