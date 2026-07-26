if (!document.getElementById("battle-overlay")) {

const overlay=document.createElement("div");

overlay.id="battle-overlay";

overlay.innerHTML=`
<div id="battle-box">

<h1>⚔️ TAB BATTLE ⚔️</h1>

<p>This tab has been inactive.</p>

<h2 id="timer">10</h2>

<button id="save">🛡️ SAVE ME</button>

</div>
`;

document.body.appendChild(overlay);

const style=document.createElement("style");

style.textContent=`

#battle-overlay{

position:fixed;
top:0;
left:0;
right:0;
bottom:0;
background:rgba(0,0,0,.85);
z-index:999999999;
display:flex;
justify-content:center;
align-items:center;

}

#battle-box{

background:#222;
padding:40px;
border-radius:15px;
text-align:center;
color:white;
font-family:Arial;

}

#battle-box button{

padding:15px 30px;
font-size:18px;
cursor:pointer;
background:#00c853;
border:none;
color:white;
margin-top:20px;

}

`;

document.head.appendChild(style);

let t=10;

const timer=document.getElementById("timer");

const interval=setInterval(()=>{

t--;

timer.textContent=t;

if(t===0){

clearInterval(interval);

chrome.runtime.sendMessage({
type:"kill"
});

}

},1000);

document.getElementById("save").onclick=()=>{

clearInterval(interval);

overlay.remove();

style.remove();

};

}