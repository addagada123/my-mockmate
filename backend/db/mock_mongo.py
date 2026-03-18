from typing import Any, Dict, List, Optional, Union, cast
import uuid
from datetime import datetime
from dataclasses import dataclass

@dataclass
class InsertOneResult:
    inserted_id: Any

@dataclass
class UpdateResult:
    matched_count: int
    modified_count: int

@dataclass
class DeleteResult:
    deleted_count: int

class MockObjectId:
    """Mock ObjectId that works like bson.ObjectId"""
    def __init__(self, oid=None):
        if oid is None:
            self._id = str(uuid.uuid4())
        elif isinstance(oid, MockObjectId):
            self._id = oid._id
        else:
            self._id = str(oid)
    
    def __str__(self):
        return self._id
    
    def __repr__(self):
        return f'MockObjectId("{self._id}")'
    
    def __eq__(self, other):
        if isinstance(other, MockObjectId):
            return self._id == other._id
        return str(self) == str(other)
    
    def __hash__(self):
        return hash(self._id)

class MockCursor:
    """Mock cursor that supports MongoDB cursor operations"""
    def __init__(self, results: List[Dict[str, Any]]):
        self.results = results
        self._sort_key: Optional[str] = None
        self._sort_direction = 1
        self._limit: Optional[int] = None
    
    def sort(self, key: str, direction: int = 1):
        """Sort results by key and direction"""
        self._sort_key = key
        self._sort_direction = direction
        return self

    def limit(self, count: int):
        """Limit the number of results returned"""
        self._limit = count
        return self
    
    def __iter__(self):
        results = list(self.results) # Make a copy
        if self._sort_key:
            results = sorted(
                results,
                key=lambda x: x.get(self._sort_key or "", ""),
                reverse=(self._sort_direction == -1)
            )
        if self._limit is not None:
            results = results[:self._limit]
        return iter(results)
    
    def __next__(self):
        return next(iter(self))
    
    def __len__(self):
        return len(self.results)

class MockCollection:
    def __init__(self, name: str):
        self.name = name
        self.data: Dict[str, Dict[str, Any]] = {}  # _id -> doc

    def insert_one(self, doc: Dict[str, Any]):
        if "_id" not in doc:
            doc["_id"] = MockObjectId()
        elif not isinstance(doc["_id"], MockObjectId):
            doc["_id"] = MockObjectId(doc["_id"])
        
        # Store by string representation of _id
        key = str(doc["_id"])
        self.data[key] = doc
        return InsertOneResult(inserted_id=doc["_id"])

    def find_one(self, filter: Optional[Dict[str, Any]] = None, sort: Optional[List] = None):
        # Get cursor from find
        cursor = self.find(filter)
        
        # Apply sort if provided
        if sort:
            key, direction = sort[0]
            cursor = cursor.sort(key, direction)
        
        # Get first result
        try:
            return next(iter(cursor))
        except StopIteration:
            return None

    def find(self, filter: Optional[Dict[str, Any]] = None, projection: Optional[Dict[str, Any]] = None):
        filter = filter or {}
        results = []
        for doc in self.data.values():
            match = True
            for k, v in filter.items():
                # Resolve value for potential dotted key
                val = doc
                for part in k.split('.'):
                    if isinstance(val, dict):
                        val = val.get(part)
                    else:
                        val = None
                        break
                
                # Special handle for _id comparisons if needed (though dotted keys usually aren't _id)
                if k == "_id":
                    doc_id = str(doc.get("_id", ""))
                    filter_id = str(v)
                    if doc_id != filter_id:
                        match = False
                        break
                    continue

                if k == "$or":
                    # basic OR support
                    or_match = False
                    for condition in v:
                        if isinstance(condition, dict):
                            for sk, sv in condition.items():
                                if doc.get(sk) != sv:
                                    sub_match = False
                                    break
                        if sub_match:
                            or_match = True
                            break
                    if not or_match:
                        match = False
                        break
                    continue
                
                # Check for nested operators
                if isinstance(v, dict):
                    if "$in" in v:
                        if val not in v["$in"]:
                            match = False
                            break
                    elif "$ne" in v:
                        if val == v["$ne"]:
                            match = False
                            break
                    continue

                if val != v:
                    match = False
                    break
            
            if match:
                # Apply projection if provided
                if projection:
                    projected_doc = {}
                    # Cast projection to dict to avoid 'items' attribute error
                    proj_dict: Dict[str, Any] = cast(Dict[str, Any], projection)
                    for key, include in proj_dict.items():
                        if include == 1 and key in doc:
                            projected_doc[key] = doc[key]
                    # Always include _id unless explicitly excluded
                    if "_id" not in proj_dict or proj_dict.get("_id") != 0:
                        projected_doc["_id"] = doc.get("_id")
                    results.append(projected_doc)
                else:
                    results.append(doc)
        
        # Return MockCursor instead of plain list
        return MockCursor(results)

    def update_one(self, filter: Optional[Dict[str, Any]] = None, update: Optional[Dict[str, Any]] = None, upsert: bool = False):
        filter = filter or {}
        update = update or {}
        doc = self.find_one(filter)
        if not doc:
            if upsert:
                new_doc = filter.copy()
                if "$set" in update:
                    new_doc.update(update["$set"])
                if "$push" in update:
                    for k, v in update["$push"].items():
                        new_doc[k] = [v]
                return self.insert_one(new_doc)
            return UpdateResult(matched_count=0, modified_count=0)
        
        if "$set" in update:
            doc.update(update["$set"])
        if "$push" in update:
            for k, v in update["$push"].items():
                if k not in doc:
                    doc[k] = []
                doc[k].append(v)
        
        return UpdateResult(matched_count=1, modified_count=1)

    def delete_one(self, filter: Optional[Dict[str, Any]] = None):
        filter = filter or {}
        doc = self.find_one(filter)
        if doc and "_id" in doc:
            self.data.pop(str(doc["_id"]), None)
            return DeleteResult(deleted_count=1)
        return DeleteResult(deleted_count=0)
        
    def count_documents(self, filter: Optional[Dict[str, Any]] = None) -> int:
        return len(list(self.find(filter)))

class MockDatabase:
    def __init__(self):
        self.collections = {}

    def __getitem__(self, name):
        if name not in self.collections:
            self.collections[name] = MockCollection(name)
        return self.collections[name]
    
    def __getattr__(self, name):
        return self.__getitem__(name)

class MockClient:
    def __init__(self, uri: Optional[str] = None, **kwargs):
        self.db = MockDatabase()
    
    def __getitem__(self, name):
        return self.db
        
    def close(self):
        pass
        
    def server_info(self):
        return {"version": "MockDB 1.0"}
