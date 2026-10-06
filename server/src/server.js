import "dotenv/config";import express from "express";import cors from "cors";import helmet from "helmet";import rateLimit from "express-rate-limit";import mongoose from "mongoose";import bcrypt from "bcryptjs";import jwt from "jsonwebtoken";import crypto from "crypto";
const app=express();app.use(helmet());app.use(cors({origin:true,methods:["GET","POST","PATCH","PUT","DELETE","OPTIONS"],allowedHeaders:["Content-Type","Authorization"]}));app.use(express.json({limit:"1mb"}));app.use(rateLimit({windowMs:15*60*1000,max:3000,standardHeaders:true,legacyHeaders:false,message:{message:"Too many requests. Please wait a moment and try again."}}));
const User=mongoose.model("User",new mongoose.Schema({name:{type:String,required:true,trim:true},email:{type:String,required:true,unique:true,lowercase:true,trim:true},passwordHash:{type:String,required:true},role:{type:String,enum:["customer","driver","admin"],default:"customer"},status:{type:String,enum:["active","suspended"],default:"active"},isPrimaryAdmin:{type:Boolean,default:false},isTestUser:{type:Boolean,default:false,index:true},phone:String,createdAt:{type:Date,default:Date.now}}));
const Shipment=mongoose.model("Shipment",new mongoose.Schema({trackingNumber:{type:String,unique:true,index:true},customerId:{type:mongoose.Schema.Types.ObjectId,ref:"User",default:null},driverId:{type:mongoose.Schema.Types.ObjectId,ref:"User",default:null},senderName:String,senderPhone:String,pickupAddress:String,receiverName:String,receiverPhone:String,destinationAddress:String,packageDescription:String,category:{type:String,default:"General"},weight:Number,priority:{type:String,default:"Standard"},notes:String,shipmentType:{type:String,enum:["send_to_someone","order_for_myself"],default:"send_to_someone"},status:{type:String,default:"Pending"},deliveryConfirmedByCustomer:{type:Boolean,default:false},deliveryConfirmedAt:Date,createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}}));
const History=mongoose.model("StatusHistory",new mongoose.Schema({shipmentId:mongoose.Schema.Types.ObjectId,status:String,note:String,changedBy:mongoose.Schema.Types.ObjectId,createdAt:{type:Date,default:Date.now}}));
const Location=mongoose.model("Location",new mongoose.Schema({shipmentId:mongoose.Schema.Types.ObjectId,driverId:mongoose.Schema.Types.ObjectId,latitude:Number,longitude:Number,accuracy:Number,speed:Number,recordedAt:{type:Date,default:Date.now}}));const DriverLocation=mongoose.model("DriverLocation",new mongoose.Schema({driverId:{type:mongoose.Schema.Types.ObjectId,ref:"User",unique:true,required:true},latitude:Number,longitude:Number,accuracy:Number,speed:Number,recordedAt:{type:Date,default:Date.now}}));
const ClaimRequest=mongoose.model("ClaimRequest",new mongoose.Schema({shipmentId:{type:mongoose.Schema.Types.ObjectId,ref:"Shipment",required:true},driverId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true},status:{type:String,enum:["pending","approved","rejected"],default:"approved"},createdAt:{type:Date,default:Date.now},handledAt:Date}));
const publicUser=u=>({id:u._id,name:u.name,email:u.email,role:u.role,status:u.status,isPrimaryAdmin:!!u.isPrimaryAdmin,isTestUser:!!u.isTestUser,phone:u.phone});const sign=u=>jwt.sign({userId:u._id.toString()},process.env.JWT_SECRET,{expiresIn:"7d"});const auth=async(req,res,next)=>{try{const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))throw Error();const p=jwt.verify(h.slice(7),process.env.JWT_SECRET);req.user=await User.findById(p.userId).select("-passwordHash");if(!req.user)throw Error();if(req.user.status==="suspended")return res.status(403).json({message:"This account is suspended"});next()}catch{res.status(401).json({message:"Authentication required"})}};const role=(...r)=>(req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({message:"Forbidden"});
app.get("/api/health",(req,res)=>res.json({status:"ok"}));
app.post("/api/auth/register",async(req,res)=>{try{const{name,email,password,phone,role:requestedRole}=req.body;if(!name||!email||!password)return res.status(400).json({message:"Name, email and password are required"});if(password.length<8)return res.status(400).json({message:"Password must be at least 8 characters"});if(await User.exists({email}))return res.status(409).json({message:"Email already registered"});const role=requestedRole==="driver"?"driver":"customer";const u=await User.create({name,email,passwordHash:await bcrypt.hash(password,12),phone,role,status:"active"});res.status(201).json({token:sign(u),user:publicUser(u)})}catch(e){res.status(400).json({message:e.message})}});
app.post("/api/auth/login",async(req,res)=>{const email=String(req.body.email||"").trim().toLowerCase();const u=await User.findOne({email});if(!u||!(await bcrypt.compare(req.body.password||"",u.passwordHash)))return res.status(401).json({message:"Invalid email or password"});if(u.status==="suspended")return res.status(403).json({message:"This account is suspended"});res.json({token:sign(u),user:publicUser(u)})});
app.get("/api/auth/me",auth,(req,res)=>res.json({user:publicUser(req.user)}));
const tracking=()=> "LF-"+new Date().getFullYear()+"-"+crypto.randomBytes(4).toString("hex").toUpperCase();
async function cleanupShipmentRecords(ids){
  if(!ids.length)return;
  await Promise.all([
    History.deleteMany({shipmentId:{$in:ids}}),
    Location.deleteMany({shipmentId:{$in:ids}}),
    ClaimRequest.deleteMany({shipmentId:{$in:ids}}),
    Shipment.deleteMany({_id:{$in:ids}})
  ]);
}
async function deleteShipmentsForUser(userId){
  const ids=(await Shipment.find({$or:[{customerId:userId},{driverId:userId}]}).select("_id")).map(x=>x._id);
  await cleanupShipmentRecords(ids);
  return ids.length;
}
async function cleanupOrphanedData(){
  const [users,shipments]=await Promise.all([
    User.find({}).select("_id role"),
    Shipment.find({}).select("_id customerId driverId")
  ]);
  const userIds=users.map(u=>u._id);
  const userSet=new Set(users.map(u=>String(u._id)));
  const driverSet=new Set(users.filter(u=>u.role==="driver").map(u=>String(u._id)));

  const orphanShipmentIds=shipments
    .filter(s=>!s.customerId||!userSet.has(String(s.customerId)))
    .map(s=>s._id);

  if(orphanShipmentIds.length)await cleanupShipmentRecords(orphanShipmentIds);

  const orphanSet=new Set(orphanShipmentIds.map(id=>String(id)));
  const invalidDriverShipmentIds=shipments
    .filter(s=>!orphanSet.has(String(s._id))&&s.driverId&&!driverSet.has(String(s.driverId)))
    .map(s=>s._id);

  if(invalidDriverShipmentIds.length){
    await Shipment.updateMany(
      {_id:{$in:invalidDriverShipmentIds}},
      {$set:{driverId:null,status:"Pending",updatedAt:new Date()}}
    );
  }

  const validShipmentIds=await Shipment.distinct("_id");
  const driverIds=Array.from(driverSet);
  const claimFilter=driverIds.length
    ? {$or:[{shipmentId:{$nin:validShipmentIds}},{driverId:{$nin:driverIds}}]}
    : {};

  const [historyResult,locationResult,claimResult,driverLocationResult]=await Promise.all([
    History.deleteMany({shipmentId:{$nin:validShipmentIds}}),
    Location.deleteMany({shipmentId:{$nin:validShipmentIds}}),
    ClaimRequest.deleteMany(claimFilter),
    DriverLocation.deleteMany({driverId:{$nin:userIds}})
  ]);

  const cleaned={
    orphanShipments:orphanShipmentIds.length,
    invalidShipmentDrivers:invalidDriverShipmentIds.length,
    orphanHistory:historyResult.deletedCount||0,
    orphanLocations:locationResult.deletedCount||0,
    orphanClaims:claimResult.deletedCount||0,
    orphanDriverLocations:driverLocationResult.deletedCount||0
  };
  const total=Object.values(cleaned).reduce((a,b)=>a+b,0);
  if(total)console.log("E-LOGS database cleanup:",cleaned);
  return cleaned;
}

app.get("/api/shipments",auth,async(req,res)=>{
  let f=req.user.role==="customer"
    ?{customerId:req.user._id}
    :req.user.role==="driver"
      ?req.query.available==="true"
        ?{driverId:null,status:"Pending"}
        :req.query.assigned==="true"
          ?{driverId:req.user._id,status:{$nin:["Delivered","Cancelled","Failed Delivery"]}}
          :{driverId:req.user._id}
      :{};
  if(req.user.role==="admin"){
    const hidden=(await User.find({isTestUser:true}).select("_id")).map(x=>x._id);
    if(hidden.length)f={$and:[f,{$or:[{customerId:null},{customerId:{$nin:hidden}}]},{$or:[{driverId:null},{driverId:{$nin:hidden}}]}]};
  }
  res.json({shipments:await Shipment.find(f).populate("customerId","name email").populate("driverId","name email").sort({createdAt:-1})});
});
app.post("/api/shipments",auth,role("customer"),async(req,res)=>{
  try{
    const body={...req.body};
    const textFields=["senderName","pickupAddress","receiverName","destinationAddress","packageDescription","category","priority","notes"];
    for(const k of textFields)if(body[k]!=null)body[k]=String(body[k]).trim();
    for(const k of ["senderPhone","receiverPhone"])if(body[k]!=null)body[k]=String(body[k]).replace(/[^0-9+]/g,"");
    if(!["send_to_someone","order_for_myself"].includes(body.shipmentType))return res.status(400).json({message:"Choose whether this delivery is for someone else or for yourself"});
    if(!body.senderName||!body.senderPhone||!body.pickupAddress||!body.receiverName||!body.receiverPhone||!body.destinationAddress||!body.packageDescription||!body.category)return res.status(400).json({message:"Please complete all required delivery information"});
    if(body.weight!==""&&body.weight!=null){
      const n=Number(body.weight);
      if(!Number.isFinite(n)||n<0)return res.status(400).json({message:"Weight must be a valid number"});
      body.weight=n;
    }else body.weight=null;
    let t=tracking();while(await Shipment.exists({trackingNumber:t}))t=tracking();
    const s=await Shipment.create({...body,customerId:req.user._id,trackingNumber:t,status:"Pending"});
    await History.create({shipmentId:s._id,status:"Pending",note:"Shipment created",changedBy:req.user._id});
    res.status(201).json({shipment:s});
  }catch(e){res.status(400).json({message:e.message})}
});
app.get("/api/shipments/:id",auth,async(req,res)=>{
  const s=await Shipment.findById(req.params.id).populate("customerId","name email phone").populate("driverId","name email phone");
  if(!s)return res.status(404).json({message:"Shipment not found"});
  if(req.user.role==="customer"&&s.customerId._id.toString()!==req.user._id.toString())return res.status(403).json({message:"Forbidden"});
  if(req.user.role==="driver"&&(!s.driverId||s.driverId._id.toString()!==req.user._id.toString()))return res.status(403).json({message:"Forbidden"});
  res.json({shipment:{...s.toObject(),statusHistory:await History.find({shipmentId:s._id}).sort({createdAt:1}),latestLocation:await Location.findOne({shipmentId:s._id}).sort({recordedAt:-1})}});
});
const next={Pending:["Assigned","Cancelled"],Assigned:["Picked Up","Cancelled"],"Picked Up":["In Transit"],"In Transit":["Out for Delivery","Failed Delivery"],"Out for Delivery":["Delivered","Failed Delivery"],Delivered:[],Cancelled:[],"Failed Delivery":[]};
app.post("/api/shipments/:id/claim",auth,role("driver"),async(req,res)=>{
  const gps=await DriverLocation.findOne({driverId:req.user._id});
  if(!gps||Date.now()-new Date(gps.recordedAt).getTime()>120000)return res.status(400).json({message:"Turn on your location before claiming a shipment"});
  const s=await Shipment.findOne({_id:req.params.id,driverId:null,status:"Pending"});
  if(!s)return res.status(409).json({message:"This shipment is no longer available"});
  s.driverId=req.user._id;s.status="Assigned";s.updatedAt=new Date();await s.save();
  await ClaimRequest.create({shipmentId:s._id,driverId:req.user._id,status:"approved",handledAt:new Date()});
  await Location.findOneAndUpdate({shipmentId:s._id},{shipmentId:s._id,driverId:req.user._id,latitude:gps.latitude,longitude:gps.longitude,accuracy:gps.accuracy,speed:gps.speed,recordedAt:new Date()},{upsert:true,new:true,setDefaultsOnInsert:true});
  await History.create({shipmentId:s._id,status:"Assigned",note:"Driver claimed shipment. Admin notified.",changedBy:req.user._id});
  res.json({shipment:s,message:"Shipment claimed. Admin has been notified."});
});
app.post("/api/shipments/:id/confirm-delivery",auth,role("customer"),async(req,res)=>{
  const s=await Shipment.findById(req.params.id);
  if(!s||String(s.customerId)!==String(req.user._id))return res.status(403).json({message:"Forbidden"});
  if(s.status!=="Out for Delivery")return res.status(400).json({message:"Delivery can be confirmed when the driver is out for delivery"});
  s.deliveryConfirmedByCustomer=true;s.deliveryConfirmedAt=new Date();s.updatedAt=new Date();await s.save();
  await History.create({shipmentId:s._id,status:s.status,note:"Customer confirmed receipt. Admin can complete delivery.",changedBy:req.user._id});
  res.json({shipment:s,message:"Receipt confirmed. Admin has been notified."});
});
app.patch("/api/shipments/:id/status",auth,role("driver","admin"),async(req,res)=>{const s=await Shipment.findById(req.params.id);if(!s)return res.status(404).json({message:"Shipment not found"});if(req.user.role==="driver"&&String(s.driverId)!==String(req.user._id))return res.status(403).json({message:"Only the assigned driver can update this shipment"});if(!next[s.status]?.includes(req.body.status))return res.status(400).json({message:"Invalid status transition"});s.status=req.body.status;s.updatedAt=new Date();await s.save();await History.create({shipmentId:s._id,status:s.status,note:req.body.note||"Status updated",changedBy:req.user._id});res.json({shipment:s})});
app.post("/api/admin/cleanup",auth,role("admin"),async(req,res)=>{
  try{res.json({message:"Database cleanup complete",cleanup:await cleanupOrphanedData()})}
  catch(e){res.status(500).json({message:"Database cleanup failed",error:e.message})}
});
app.get("/api/claims",auth,role("admin"),async(req,res)=>{const claims=await ClaimRequest.find({}).populate("driverId","name email phone isTestUser").populate({path:"shipmentId",populate:[{path:"customerId",select:"name email isTestUser"},{path:"driverId",select:"name email isTestUser"}]}).sort({createdAt:-1});const visible=claims.filter(c=>!c.driverId?.isTestUser&&!c.shipmentId?.customerId?.isTestUser&&!c.shipmentId?.driverId?.isTestUser);res.json({claims:visible})});
app.patch("/api/shipments/:id/assign",auth,role("admin"),async(req,res)=>{const s=await Shipment.findById(req.params.id);if(!s)return res.status(404).json({message:"Shipment not found"});if(!req.body.driverId){s.driverId=null;if(["Assigned","Picked Up"].includes(s.status))s.status="Pending";s.updatedAt=new Date();await s.save();await History.create({shipmentId:s._id,status:s.status,note:"Driver unassigned by admin",changedBy:req.user._id});return res.json({shipment:s,message:"Driver unassigned"})}const d=await User.findOne({_id:req.body.driverId,role:"driver",status:"active"});if(!d)return res.status(404).json({message:"Active driver not found"});s.driverId=d._id;if(s.status==="Pending")s.status="Assigned";s.updatedAt=new Date();await s.save();await History.create({shipmentId:s._id,status:s.status,note:"Driver assigned by admin",changedBy:req.user._id});res.json({shipment:s,message:"Driver assigned"})});
app.get("/api/users/:id/shipments",auth,role("admin"),async(req,res)=>{const u=await User.findById(req.params.id).select("name email role status");if(!u)return res.status(404).json({message:"User not found"});const filter=u.role==="driver"?{driverId:u._id}:{customerId:u._id};res.json({user:u,shipments:await Shipment.find(filter).populate("customerId","name email").populate("driverId","name email").sort({createdAt:-1})});});app.get("/api/users",auth,role("admin"),async(req,res)=>{
  const includeTest=req.query.includeTest==="true";const users=await User.find(includeTest?{}:{isTestUser:{$ne:true}}).select("name email phone role status isPrimaryAdmin isTestUser createdAt").sort({createdAt:1});
  res.json({users});
});
app.get("/api/users/drivers",auth,role("admin"),async(req,res)=>res.json({users:await User.find({role:"driver"}).select("name email phone role status isPrimaryAdmin createdAt").sort({createdAt:1})}));
app.patch("/api/users/:id/status",auth,role("admin"),async(req,res)=>{
  const u=await User.findById(req.params.id);
  if(!u)return res.status(404).json({message:"User not found"});
  if(String(u._id)===String(req.user._id)||u.isPrimaryAdmin)return res.status(403).json({message:"You cannot suspend the admin account you are currently using"});
  if(!["active","suspended"].includes(req.body.status))return res.status(400).json({message:"Invalid account status"});
  u.status=req.body.status;await u.save();res.json({user:publicUser(u)});
});
app.patch("/api/users/:id/role",auth,role("admin"),async(req,res)=>{
  const u=await User.findById(req.params.id);
  if(!u)return res.status(404).json({message:"User not found"});
  if(String(u._id)===String(req.user._id)||u.isPrimaryAdmin)return res.status(403).json({message:"You cannot change the admin account you are currently using"});
  if(!["customer","driver","admin"].includes(req.body.role))return res.status(400).json({message:"Invalid role"});
  u.role=req.body.role;u.status="active";await u.save();res.json({user:publicUser(u)});
});
app.patch("/api/users/:id/test",auth,role("admin"),async(req,res)=>{const u=await User.findById(req.params.id);if(!u)return res.status(404).json({message:"User not found"});if(u.isPrimaryAdmin)return res.status(403).json({message:"The primary admin cannot be marked as a test user"});u.isTestUser=req.body.isTestUser===true;await u.save();res.json({user:publicUser(u)});});app.delete("/api/users/:id",auth,role("admin"),async(req,res)=>{
  const u=await User.findById(req.params.id);
  if(!u)return res.status(404).json({message:"User not found"});
  if(String(u._id)===String(req.user._id))return res.status(403).json({message:"You cannot delete the admin account you are currently using"});  if(u.isPrimaryAdmin)return res.status(403).json({message:"The primary admin cannot be deleted"});
  const deletedShipments=await deleteShipmentsForUser(u._id);await Promise.all([DriverLocation.deleteOne({driverId:u._id}),ClaimRequest.deleteMany({driverId:u._id}),User.deleteOne({_id:u._id})]);res.json({message:"User deleted",deletedShipments});
});
app.post("/api/drivers/location",auth,role("driver"),async(req,res)=>{const {latitude,longitude,accuracy,speed}=req.body;if(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude)))return res.status(400).json({message:"Valid location is required"});const now=new Date(),lat=Number(latitude),lng=Number(longitude);const gps=await DriverLocation.findOneAndUpdate({driverId:req.user._id},{driverId:req.user._id,latitude:lat,longitude:lng,accuracy:Number(accuracy)||undefined,speed:Number(speed)||undefined,recordedAt:now},{upsert:true,new:true,setDefaultsOnInsert:true});const assigned=await Shipment.find({driverId:req.user._id,status:{$nin:["Delivered","Cancelled","Failed Delivery"]}}).select("_id");await Promise.all(assigned.map(x=>Location.findOneAndUpdate({shipmentId:x._id},{shipmentId:x._id,driverId:req.user._id,latitude:lat,longitude:lng,accuracy:Number(accuracy)||undefined,speed:Number(speed)||undefined,recordedAt:now},{upsert:true,new:true,setDefaultsOnInsert:true})));res.json({location:gps})});app.post("/api/shipments/:id/location",auth,role("driver"),async(req,res)=>{const s=await Shipment.findById(req.params.id);if(!s||String(s.driverId)!==String(req.user._id))return res.status(403).json({message:"Forbidden"});const l=await Location.findOneAndUpdate({shipmentId:s._id},{shipmentId:s._id,driverId:req.user._id,latitude:req.body.latitude,longitude:req.body.longitude,recordedAt:new Date()},{upsert:true,new:true,setDefaultsOnInsert:true});res.status(201).json({location:l})});
app.get("/api/track/:trackingNumber",async(req,res)=>{const s=await Shipment.findOne({trackingNumber:req.params.trackingNumber}).populate("driverId","name");if(!s)return res.status(404).json({message:"Shipment not found"});res.json({shipment:{...s.toObject(),statusHistory:await History.find({shipmentId:s._id}).sort({createdAt:1}),latestLocation:await Location.findOne({shipmentId:s._id}).sort({recordedAt:-1})}})});
app.use((req,res)=>res.status(404).json({message:"Route not found"}));
app.get("/",(req,res)=>res.json({name:"LogisticsFav API",status:"ok",health:"/api/health"}));
const port=process.env.PORT||5000;
async function isolateObviousTestUsers(){const candidates=await User.find({isTestUser:{$ne:true}}).select("_id name email isPrimaryAdmin");const ids=candidates.filter(u=>{if(u.isPrimaryAdmin)return false;const v=(String(u.name||"")+" "+String(u.email||"")).toLowerCase();return v.includes("test")||v.includes("demo")||v.includes("dummy")||v.includes("sandbox")||v.includes("qa");}).map(u=>u._id);if(ids.length)await User.updateMany({_id:{$in:ids}},{$set:{isTestUser:true}});}async function seedDemoUsers(){
  // Keep exactly one controlled admin account in sync with the Render environment.
  // Driver accounts are created by users through registration, so there is no fixed demo driver.
  const email=(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
  const password=process.env.ADMIN_PASSWORD||"";
  if(!email||!password||password.startsWith("replace-with-")) return;
  const passwordHash=await bcrypt.hash(password,12);
  await User.findOneAndUpdate(
    {email},
    {name:"LogisticsFav Admin",email,passwordHash,role:"admin",status:"active",isPrimaryAdmin:true},
    {upsert:true,new:true,setDefaultsOnInsert:true}
  );
}
async function start(){
  if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
  await mongoose.connect(process.env.MONGODB_URI);
  await seedDemoUsers();
  await isolateObviousTestUsers();
  await cleanupOrphanedData();
  setInterval(()=>cleanupOrphanedData().catch(e=>console.error("E-LOGS database cleanup failed:",e)),30000);
  app.listen(port,()=>console.log("LogisticsFav API running on "+port));
}
start().catch(e=>{console.error("LogisticsFav startup failed:",e);process.exit(1)});