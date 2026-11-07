// Navigation reflects effective facility privileges; backend authorization remains authoritative.
export function worklistTabs(privileges = []) {
  const has = (...required) => required.every(p => privileges.includes(p));
  return [
    {id:'reception', label:'Front desk', required:['encounter:read','appointment:read'], icon:'appointments'},
    {id:'vitals', label:'Nursing & vitals', required:['encounter:read','observation:write'], icon:'nursing'},
    {id:'consultation', label:'Consultations', required:['encounter:read','encounter:consult'], icon:'clinical'},
    {id:'radiology', label:'Radiology', required:['patient:read','imaging:view','imaging:worklist'], icon:'imaging'},
    {id:'laboratory', label:'Laboratory', required:['lab:read','lab:worklist'], icon:'laboratory'},
  ].filter(item => has(...item.required));
}
export function canUseLaboratoryCriticalResults(privileges = []) {
  const has = p => privileges.includes(p);
  return has('lab:read') && (has('lab:critical:ack') || (has('lab:worklist') && (has('lab:verify') || has('lab:result'))));
}
export function workspaceNavigation(privileges = []) {
  return [
    {id:'workspace', label:'Workspace', href:'/', icon:'dashboard'},
    ...(privileges.includes('patient:read') ? [{id:'patients', label:'Patients', href:'/patients', icon:'patients'}] : []),
    ...worklistTabs(privileges).map(item => ({...item, href:`/worklists?queue=${item.id}`})),
    ...(canUseCriticalResults(privileges) ? [{id:'critical', label:'Critical follow-up', href:'/critical-results', icon:'nursing'}] : []),
    {id:'notifications', label:'Notifications', href:'/notifications', icon:'notifications'},
  ];
}

export function canUseImagingHandoffs(privileges=[]){const has=p=>privileges.includes(p);return has('patient:read')&&has('imaging:view')&&(has('imaging:acknowledge')||(has('imaging:worklist')&&has('imaging:communicate')));}
export function canUseCriticalResults(privileges=[]){return canUseLaboratoryCriticalResults(privileges)||canUseImagingHandoffs(privileges);}
