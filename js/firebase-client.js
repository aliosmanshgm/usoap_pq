import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { FIREBASE_CONFIG } from "./config.js";

// Faz 8B.1 - Firebase SDK/version centralized in one module.
export function createFirebaseClient() {
  const app = initializeApp(FIREBASE_CONFIG);
  return { app, db: getFirestore(app), auth: getAuth(app) };
}

export {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, query, where,
  onAuthStateChanged, signInWithEmailAndPassword, signOut
};
