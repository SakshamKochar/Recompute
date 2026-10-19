const routes=['Sell now','List and wait','Host longer','Yield while listed','Harvest','Repair'];
// Demo adapter: replace assets, market assumptions, and calculate() with backend services.
const assets=[
{id:'RC-001',model:'NVIDIA H100',memory:'80 GB · SXM5',site:'Phoenix · AZ-01',health:98,value:21800,rate:2.1,watts:700,age:14,route:3},
{id:'RC-002',model:'NVIDIA A100',memory:'80 GB · SXM4',site:'Phoenix · AZ-01',health:94,value:11200,rate:1.15,watts:400,age:29,route:0},
{id:'RC-003',model:'NVIDIA RTX 4090',memory:'24 GB · PCIe',site:'Austin · TX-02',health:96,value:1480,rate:.38,watts:450,age:19,route:2},
{id:'RC-004',model:'NVIDIA A6000',memory:'48 GB · PCIe',site:'Austin · TX-02',health:89,value:3100,rate:.52,watts:300,age:34,route:1},
{id:'RC-005',model:'NVIDIA A100',memory:'40 GB · PCIe',site:'Phoenix · AZ-01',health:67,value:5700,rate:.68,watts:250,age:41,route:5},
{id:'RC-006',model:'NVIDIA V100',memory:'16 GB · SXM2',site:'Portland · OR-03',health:42,value:410,rate:.12,watts:300,age:68,route:4},
{id:'RC-007',model:'NVIDIA H100',memory:'80 GB · PCIe',site:'Portland · OR-03',health:97,value:19500,rate:1.85,watts:350,age:12,route:3},
{id:'RC-008',model:'NVIDIA RTX 3090',memory:'24 GB · PCIe',site:'Austin · TX-02',health:88,value:680,rate:.24,watts:350,age:40,route:0}];
function calculate(a,util=70,energy=.12,days=90,decline=3){let revenue=a.rate*24*days*util/100,power=a.watts/1000*24*days*(.35+.65*util/100)*energy,fees=revenue*.12,net=revenue-power-fees,residual=a.value*Math.pow(1-decline/100,days/30),sale=a.value*.95;return {revenue,power,fees,net,residual,sale,host:residual*.95+net,wait:a.value*1.035*Math.pow(1-decline/100,days/60)*.95,hybrid:a.value*Math.pow(1-decline/100,days/60)*.95+net*.5,repair:(a.value*(a.health<70?1.24:1))*.95-380,harvest:a.value*.34}}
