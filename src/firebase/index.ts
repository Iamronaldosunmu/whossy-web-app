import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { FacebookAuthProvider, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC4KtUH2ggeSOmcQ_7WJPQpO-WeeNhpJHQ",
  authDomain: "whossy-app.firebaseapp.com",
  projectId: "whossy-app",
  storageBucket: "whossy-app.appspot.com",
  messagingSenderId: "332139466657",
  appId: "1:332139466657:web:26e95148b069f63f2d05e0",
  measurementId: "G-QQ1B249HVJ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const facebookProvider = new FacebookAuthProvider();

export {auth, db, googleProvider, facebookProvider}