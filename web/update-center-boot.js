(() => {
  const RELEASE='__AWH_WEB_RELEASE_ID__';
  const key='awh-update-center-boot-'+RELEASE;
  window.__AWH_UPDATE_CENTER_BOOT_OK__=false;
  let recovering=false;

  async function recover(){
    if(window.__AWH_UPDATE_CENTER_BOOT_OK__||recovering)return;
    recovering=true;
    if(sessionStorage.getItem(key)==='1'){
      const overall=document.getElementById('updates-overall');
      const list=document.getElementById('update-list');
      if(overall){overall.textContent='ตรวจไม่สำเร็จ';overall.dataset.tone='bad';}
      if(list)list.innerHTML='<div class="update-empty">กำลังเรียกหน้า Update Center รุ่นใหม่ กรุณากด “ตรวจอีกครั้ง”</div>';
      return;
    }
    sessionStorage.setItem(key,'1');
    try{
      if('serviceWorker' in navigator){
        const registrations=await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration)=>registration.update().catch(()=>null)));
      }
    }finally{
      const url=new URL(location.href);
      url.searchParams.set('boot',RELEASE);
      url.searchParams.set('_',String(Date.now()));
      location.replace(url.toString());
    }
  }

  setTimeout(()=>void recover(),2500);
  addEventListener('pageshow',(event)=>{if(event.persisted)setTimeout(()=>void recover(),100);});
})();