export function TaskProgress({steps,current,label,complete=false}:{steps:string[];current:number;label:string;complete?:boolean}){
 return <ol className="task-progress" aria-label={label}>{steps.map((step,index)=>{const done=complete||index<current,active=!complete&&index===current;return <li key={step} className={done?'is-done':active?'is-current':''} aria-current={active?'step':undefined}><span aria-hidden="true">{done?'✓':index+1}</span><small>{step}</small></li>;})}</ol>;
}
