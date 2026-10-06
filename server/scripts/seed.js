import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema=new mongoose.Schema({name:String,email:{type:String,unique:true},passwordHash:String,role:String,phone:String,createdAt:{type:Date,default:Date.now}});
const User=mongoose.model("User",userSchema);

const accounts=[
  {name:"LogisticsFav Admin",email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD,role:"admin"},
  {name:"LogisticsFav Driver",email:process.env.DRIVER_EMAIL,password:process.env.DRIVER_PASSWORD,role:"driver"}
];

if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if(accounts.some(a=>!a.email||!a.password)) throw new Error("Set ADMIN_EMAIL, ADMIN_PASSWORD, DRIVER_EMAIL and DRIVER_PASSWORD");

await mongoose.connect(process.env.MONGODB_URI);
for(const account of accounts){
  const passwordHash=await bcrypt.hash(account.password,12);
  await User.findOneAndUpdate(
    {email:account.email},
    {name:account.name,email:account.email,passwordHash,role:account.role},
    {upsert:true,new:true,setDefaultsOnInsert:true}
  );
  console.log("Seeded "+account.role+": "+account.email);
}
await mongoose.disconnect();
